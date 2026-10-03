"""Supported Sign in with ChatGPT OAuth and account-scoped model discovery."""

from __future__ import annotations

import base64
import hashlib
import secrets
import time
from urllib.parse import urlencode, urlparse

import httpx
import jwt
from pydantic import BaseModel, Field

from expenses.ai import credentials
from expenses.ai.client import LLMDisabledError

AUTH_ORIGIN = "https://auth.openai.com"
API_ORIGIN = "https://api.openai.com/v1"
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
USAGE_URL = "https://chatgpt.com/settings/usage"


class ChatGPTError(LLMDisabledError):
    def __init__(self, message: str, code: str = "chatgpt_unavailable"):
        super().__init__(message)
        self.code = code


class TokenGrant(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)
    access_token: str = Field(min_length=1, max_length=32768)
    refresh_token: str = Field(min_length=1, max_length=32768)
    id_token: str = Field(min_length=1, max_length=32768)
    scope: str = Field(max_length=2000)
    expires_in: int = Field(gt=0, le=86400)


def provider_error(status: int, body: object = None) -> ChatGPTError:
    error = body.get("error", body) if isinstance(body, dict) else {}
    code = error.get("code", "") if isinstance(error, dict) else str(error)
    if code == "subscription_sharing_usage_limit_exceeded" or status == 429:
        return ChatGPTError(
            "ChatGPT usage limit reached. Review your plan and app limits in ChatGPT settings.",
            "usage_limit",
        )
    if code == "subscription_sharing_usage_unavailable":
        return ChatGPTError(
            "ChatGPT usage is temporarily unavailable. Try again later.",
            "usage_unavailable",
        )
    if status == 401 or code == "invalid_grant":
        return ChatGPTError("Reconnect ChatGPT in AI settings.", "reauth_required")
    if status == 403:
        return ChatGPTError(
            "This account, model, or request is not eligible for ChatGPT plan usage. Review your connection and model in AI settings.",
            "not_eligible",
        )
    return ChatGPTError("ChatGPT could not complete the request. Try again later.")


def checked_json(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except ValueError:
        body = {}
    if not response.is_success:
        raise provider_error(response.status_code, body)
    if not isinstance(body, dict):
        raise ChatGPTError("ChatGPT returned an invalid response.")
    return body


async def discovery(client: httpx.AsyncClient) -> dict:
    data = checked_json(
        await client.get(f"{AUTH_ORIGIN}/.well-known/openid-configuration")
    )
    for field in (
        "authorization_endpoint",
        "token_endpoint",
        "jwks_uri",
        "revocation_endpoint",
    ):
        url = urlparse(data.get(field, ""))
        if url.scheme != "https" or url.netloc != "auth.openai.com":
            raise ChatGPTError("ChatGPT sign-in metadata could not be verified.")
    if data.get("issuer") != AUTH_ORIGIN:
        raise ChatGPTError("ChatGPT sign-in issuer could not be verified.")
    return data


async def verify_identity(
    client: httpx.AsyncClient, token: str, client_id: str, nonce: str | None = None
) -> dict:
    metadata = await discovery(client)
    keys = checked_json(await client.get(metadata["jwks_uri"]))
    try:
        header = jwt.get_unverified_header(token)
        key = next(k for k in keys.get("keys", []) if k.get("kid") == header.get("kid"))
        claims = jwt.decode(
            token,
            jwt.PyJWK.from_dict(key).key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=AUTH_ORIGIN,
            options={"require": ["sub", "exp", "iss", "aud"]},
        )
        if nonce is not None and not secrets.compare_digest(
            str(claims.get("nonce", "")), nonce
        ):
            raise ValueError("Invalid nonce")
        return claims
    except (jwt.PyJWTError, StopIteration, ValueError, KeyError) as exc:
        raise ChatGPTError(
            "ChatGPT identity could not be verified. Start sign-in again."
        ) from exc


async def authorization_flow(user_id: int, port: int) -> dict:
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    previous = credentials.load(user_id) or {}
    client_id = previous.get("client_id", "dynamic_agent_client")
    flow = {
        "state": secrets.token_urlsafe(32),
        "nonce": secrets.token_urlsafe(32),
        "code_verifier": verifier,
        "redirect_uri": f"http://127.0.0.1:{port}/auth/callback",
        "client_id": client_id,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        metadata = await discovery(client)
    params = {
        "client_id": client_id,
        "response_type": "code",
        "scope": SCOPES,
        "resource": API_ORIGIN,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "state": flow["state"],
        "nonce": flow["nonce"],
        "redirect_uri": flow["redirect_uri"],
        "ext_agent_host_id": credentials.host_id(),
    }
    if client_id == "dynamic_agent_client":
        params["agent_name_hint"] = "Expenses"
    elif previous.get("id_token"):
        params["id_token_hint"] = previous["id_token"]
    flow["authorization_url"] = (
        metadata["authorization_endpoint"] + "?" + urlencode(params)
    )
    flow["token_endpoint"] = metadata["token_endpoint"]
    return flow


async def accept_grant(user_id: int, grant: TokenGrant, flow: dict) -> None:
    if grant.client_id == "dynamic_agent_client" or (
        flow["client_id"] != "dynamic_agent_client"
        and grant.client_id != flow["client_id"]
    ):
        raise ChatGPTError("ChatGPT registration changed. Start sign-in again.")
    async with httpx.AsyncClient(timeout=20) as client:
        identity = await verify_identity(
            client, grant.id_token, grant.client_id, flow["nonce"]
        )
    previous = credentials.load(user_id) or {}
    if previous.get("subject") and previous["subject"] != identity["sub"]:
        raise ChatGPTError(
            "This registration belongs to a different account. Reconnect the original ChatGPT account."
        )
    credentials.save(
        user_id,
        {
            **grant.model_dump(),
            "subject": identity["sub"],
            "email": identity.get("email"),
            "expires_at": time.time() + grant.expires_in,
            "status": "connected",
        },
    )


def connection_status(user_id: int) -> dict:
    saved = credentials.load(user_id) or {}
    return {
        "status": saved.get("status", "disconnected"),
        "email": saved.get("email"),
        "plan_authorized": "chatgpt.tokens.use.direct"
        in saved.get("scope", "").split(),
        "usage_url": USAGE_URL,
    }


async def access_token(user_id: int) -> str:
    async with credentials.locked(user_id):
        saved = credentials.load(user_id)
        if not saved or saved.get("status") != "connected":
            raise ChatGPTError("Connect ChatGPT in AI settings.", "reauth_required")
        if "chatgpt.tokens.use.direct" not in saved.get("scope", "").split():
            raise ChatGPTError(
                "Reconnect ChatGPT and allow Expenses to use your plan.",
                "not_authorized",
            )
        if saved["expires_at"] > time.time() + 90:
            return saved["access_token"]
        async with httpx.AsyncClient(timeout=20) as client:
            metadata = await discovery(client)
            response = await client.post(
                metadata["token_endpoint"],
                data={
                    "grant_type": "refresh_token",
                    "client_id": saved["client_id"],
                    "refresh_token": saved["refresh_token"],
                    "resource": API_ORIGIN,
                },
            )
        try:
            rotated = checked_json(response)
        except ChatGPTError as exc:
            if exc.code == "reauth_required":
                saved["status"] = "reauth_required"
                credentials.save(user_id, saved)
            raise
        if (
            not rotated.get("access_token")
            or not rotated.get("refresh_token")
            or not rotated.get("expires_in")
        ):
            raise ChatGPTError(
                "ChatGPT returned incomplete renewal credentials. Reconnect in AI settings."
            )
        saved.update(
            {
                key: rotated[key]
                for key in ("access_token", "refresh_token", "scope")
                if key in rotated
            }
        )
        saved["expires_at"] = time.time() + int(rotated["expires_in"])
        credentials.save(user_id, saved)
        if "chatgpt.tokens.use.direct" not in saved.get("scope", "").split():
            raise ChatGPTError(
                "ChatGPT plan permission was removed. Reconnect in AI settings."
            )
        return saved["access_token"]


async def disconnect(user_id: int, *, cancel_pending=None) -> bool:
    async with credentials.locked(user_id):
        if cancel_pending is not None:
            cancel_pending()
        saved = credentials.load(user_id) or {}
        confirmed = not saved.get("refresh_token")
        if saved.get("refresh_token"):
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    metadata = await discovery(client)
                    response = await client.post(
                        metadata["revocation_endpoint"],
                        data={
                            "token": saved["refresh_token"],
                            "token_type_hint": "refresh_token",
                            "client_id": saved["client_id"],
                        },
                    )
                    confirmed = response.status_code == 200
            except (httpx.HTTPError, ChatGPTError):
                confirmed = False
        # Keep registration and verified identity for subsequent reauthorization.
        credentials.save(
            user_id,
            {
                key: saved[key]
                for key in ("client_id", "subject", "email")
                if key in saved
            }
            | {"status": "disconnected"},
        )
        return confirmed


def parse_models(data: dict, *, chatgpt: bool) -> list[dict]:
    rows = data.get("models" if chatgpt else "data")
    if not isinstance(rows, list):
        raise ChatGPTError("The provider returned an invalid model list.")
    result = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or (chatgpt and row.get("visibility") != "list"):
            continue
        slug = row.get("slug" if chatgpt else "id")
        if (
            not isinstance(slug, str)
            or not slug.strip()
            or len(slug) > 200
            or slug in seen
        ):
            continue
        seen.add(slug)
        levels = row.get(
            "supported_reasoning_levels", row.get("supported_reasoning_efforts", [])
        )
        efforts = (
            [x.get("effort") if isinstance(x, dict) else x for x in levels]
            if isinstance(levels, list)
            else []
        )
        result.append(
            {
                "id": slug,
                "name": row.get("display_name")
                if isinstance(row.get("display_name"), str)
                and row["display_name"].strip()
                else slug,
                "reasoning_efforts": [
                    x
                    for x in efforts
                    if x in {"none", "minimal", "low", "medium", "high", "xhigh"}
                ],
            }
        )
    return result


async def models(user_id: int) -> list[dict]:
    token = await access_token(user_id)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            f"{API_ORIGIN}/models", headers={"Authorization": f"Bearer {token}"}
        )
    return parse_models(checked_json(response), chatgpt=True)
