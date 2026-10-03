"""External identity/inference fixtures for opt-in browser tests only.

Loaded in the Playwright child process, never in production. Expenses settings,
OAuth pairing state, encrypted persistence and API authorization remain real.
"""

import httpx


def install(mock_openai=False):
    from expenses.ai import chatgpt

    real_client = httpx.AsyncClient
    catalog = [
        {
            "slug": "gpt-6-luna",
            "display_name": "GPT-6 Luna",
            "visibility": "list",
            "supported_reasoning_levels": [{"effort": "low"}, {"effort": "medium"}],
        },
        {
            "slug": "gpt-6.1-sol",
            "display_name": "GPT-6.1 Sol",
            "visibility": "list",
            "supported_reasoning_levels": [
                {"effort": "low"},
                {"effort": "medium"},
                {"effort": "high"},
            ],
        },
    ]

    def handle(request):
        if request.url.path.endswith("openid-configuration"):
            return httpx.Response(
                200,
                json={
                    "issuer": chatgpt.AUTH_ORIGIN,
                    **{
                        field: f"{chatgpt.AUTH_ORIGIN}/{field}"
                        for field in (
                            "authorization_endpoint",
                            "token_endpoint",
                            "revocation_endpoint",
                            "jwks_uri",
                        )
                    },
                },
            )
        if request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "models": catalog,
                    "data": [{"id": row["slug"]} for row in catalog],
                },
            )
        if request.url.path.endswith("revocation_endpoint"):
            return httpx.Response(200)
        return httpx.Response(
            503,
            json={"error": "External inference is not part of this browser fixture."},
        )

    async def identity(_client, token, client_id, nonce=None):
        if token != "e2e-id-token" or client_id != "e2e-client":
            raise chatgpt.ChatGPTError("Invalid test identity")
        return {"sub": "e2e-account", "email": "test@example.com", "nonce": nonce}

    if mock_openai:
        chatgpt.verify_identity = identity

    class ExternalTransport(httpx.AsyncBaseTransport):
        def __init__(self):
            self.upstream = httpx.AsyncHTTPTransport()

        async def handle_async_request(self, request):
            if (
                request.url.host == "127.0.0.1"
                and request.url.port == 1
                and request.url.path == "/v1/models"
            ):
                return handle(request)
            if mock_openai and request.url.host in {
                "api.openai.com",
                "auth.openai.com",
            }:
                return handle(request)
            return await self.upstream.handle_async_request(request)

        async def aclose(self):
            await self.upstream.aclose()

    httpx.AsyncClient = lambda **kwargs: real_client(
        **({"transport": ExternalTransport()} | kwargs)
    )
