from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Generic, TypeVar

from pydantic import BaseModel

from expenses.ai.schemas import (
    ProductMergesOutput,
    ReceiptReadingOutput,
    RuleMiningOutput,
    TransactionTriageOutput,
)
from expenses.ai.usage import LLMUsageMetadata, usage_metadata

if TYPE_CHECKING:
    from pydantic_ai import ModelSettings

    from expenses.ai.features import ResolvedFeature


OutputT = TypeVar("OutputT", bound=BaseModel)


class LLMDisabledError(RuntimeError):
    pass


class LLMOutputError(RuntimeError):
    pass


# Caps a suggestion run's output, reasoning and retries included. It sits above
# Anthropic's largest thinking budget (32,768 tokens), so one attempt fits at any
# thinking level, and is checked here rather than sent to the backend.
OUTPUT_TOKENS_LIMIT = 40_000


@dataclass(frozen=True)
class LLMRunResult(Generic[OutputT]):
    output: OutputT
    input_tokens: int | None = None
    output_tokens: int | None = None
    usage_metadata: LLMUsageMetadata | None = None


class LLMRunner:
    async def run(
        self,
        *,
        feature: str,
        prompt_version: str,
        payload: dict[str, Any],
        output_type: type[OutputT],
        images: list[tuple[bytes, str]] | None = None,
    ) -> OutputT | LLMRunResult[OutputT]:
        """Runs one structured call. images are (data, media type) pairs sent
        after the payload."""
        raise NotImplementedError


def model_settings(resolved: ResolvedFeature, *, cache: bool = False) -> ModelSettings:
    settings: ModelSettings = {}
    if resolved.thinking == "off":
        settings["thinking"] = False
    elif resolved.thinking != "auto":
        settings["thinking"] = resolved.thinking
    if cache:
        settings["cache"] = True
    return settings


class PydanticAILLMRunner(LLMRunner):
    def __init__(self, resolved: ResolvedFeature) -> None:
        self.resolved = resolved
        self.model_name = resolved.model

    async def run(
        self,
        *,
        feature: str,
        prompt_version: str,
        payload: dict[str, Any],
        output_type: type[OutputT],
        images: list[tuple[bytes, str]] | None = None,
    ) -> LLMRunResult[OutputT]:
        from pydantic_ai import (
            Agent,
            BinaryContent,
            ModelRetry,
            PromptedOutput,
            RunContext,
        )
        from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded
        from pydantic_ai.usage import UsageLimits

        from expenses.ai.backends import build_model

        # The first build imports the backend's SDK, which takes seconds on a Pi.
        model = await asyncio.to_thread(
            build_model, self.resolved.backend, self.resolved.model
        )
        agent = Agent(
            model,
            deps_type=dict[str, Any],
            output_type=PromptedOutput(output_type),
            instructions=_instructions_for_feature(feature, output_type),
            retries=2,
            model_settings=model_settings(self.resolved),
        )
        total_retried = False

        @agent.output_validator
        async def validate_output(
            ctx: RunContext[dict[str, Any]], output: OutputT
        ) -> OutputT:
            nonlocal total_retried
            if isinstance(output, TransactionTriageOutput):
                if output.clean_title is None:
                    raise ModelRetry(
                        "Return clean_title by preserving the current title unless a "
                        "clearer merchant title is obvious."
                    )
                category_ids = {
                    int(category["id"]) for category in ctx.deps.get("categories", [])
                }
                if (
                    output.category_id is not None
                    and output.category_id not in category_ids
                ):
                    raise ModelRetry("Use only category_id values from the payload.")
                if (
                    output.category_id is None
                    and not output.tags
                    and output.confidence >= 0.6
                ):
                    raise ModelRetry(
                        "Choose a category or tags for confident transaction triage; "
                        "use lower confidence for genuinely ambiguous transactions."
                    )
            if isinstance(output, RuleMiningOutput):
                category_ids = {
                    int(category["id"]) for category in ctx.deps.get("categories", [])
                }
                tag_names = {str(tag["name"]) for tag in ctx.deps.get("tags", [])}
                evidence_ids = {
                    int(txn_id)
                    for cluster in ctx.deps.get("correction_clusters", [])
                    for txn_id in cluster.get("evidence_transaction_ids", [])
                }
                for proposal in output.proposals:
                    if not proposal.evidence_transaction_ids:
                        raise ModelRetry(
                            "Every rule proposal needs evidence_transaction_ids from "
                            "the payload."
                        )
                    if any(
                        txn_id not in evidence_ids
                        for txn_id in proposal.evidence_transaction_ids
                    ):
                        raise ModelRetry(
                            "Use only evidence_transaction_ids from the payload."
                        )
                    if (
                        proposal.set_category_id is not None
                        and proposal.set_category_id not in category_ids
                    ):
                        raise ModelRetry(
                            "Use only set_category_id values from the payload."
                        )
                    if any(tag not in tag_names for tag in proposal.add_tags):
                        raise ModelRetry("Use only add_tags values from the payload.")
                    if proposal.set_category_id is None and not proposal.add_tags:
                        raise ModelRetry(
                            "Every rule proposal needs set_category_id or add_tags."
                        )
            if isinstance(output, ReceiptReadingOutput):
                if any(
                    item.kind == "discount" and item.amount_cents >= 0
                    for item in output.items
                ):
                    raise ModelRetry("Give every discount a negative amount_cents.")
                lines_cents = sum(item.amount_cents for item in output.items)
                # One retry catches most misread prices. A receipt that still
                # does not add up is kept as read rather than lost.
                if (
                    output.total_cents is not None
                    and lines_cents != output.total_cents
                    and not total_retried
                ):
                    total_retried = True
                    raise ModelRetry(
                        f"The lines add up to {lines_cents} cents, but the receipt's "
                        f"total is {output.total_cents} cents. Read the prices, "
                        "quantities, and discounts again."
                    )
            if isinstance(output, ProductMergesOutput):
                known = set(ctx.deps.get("products", {}))
                sources = [name for merge in output.merges for name in merge.names]
                if any(name not in known for name in sources):
                    raise ModelRetry("Merge only names from the payload's products.")
                if len(sources) != len(set(sources)):
                    raise ModelRetry("Put each name in at most one merge.")
                fixed = {
                    name
                    for name, entry in ctx.deps.get("products", {}).items()
                    if entry.get("named_by_owner")
                }
                if fixed.intersection(sources):
                    raise ModelRetry(
                        "Never merge away a name the owner chose; merge into it instead."
                    )
                if any(merge.into in sources for merge in output.merges):
                    raise ModelRetry(
                        "Never merge into a name that is itself merged away."
                    )
            return output

        prompt = json.dumps(
            {
                "prompt_version": prompt_version,
                "payload": payload,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        try:
            result = await agent.run(
                [
                    prompt,
                    *(
                        BinaryContent(data=data, media_type=media_type)
                        for data, media_type in images or []
                    ),
                ]
                if images
                else prompt,
                deps=payload,
                usage_limits=UsageLimits(output_tokens_limit=OUTPUT_TOKENS_LIMIT),
            )
        except (UnexpectedModelBehavior, UsageLimitExceeded) as exc:
            raise LLMOutputError(str(exc)) from exc
        metadata = usage_metadata(
            usage=result.usage,
            messages=result.all_messages(),
            backend=self.resolved.backend.name,
            llm_provider=self.resolved.backend.kind,
            model=self.resolved.model,
        )
        return LLMRunResult(
            output=result.output,
            input_tokens=metadata.input_tokens,
            output_tokens=metadata.output_tokens,
            usage_metadata=metadata,
        )


# How broad a receipt item's product name is. Shared by reading and merging so both
# group at the same level.
PRODUCT_NAME_RULE = (
    "A product name says what kind of thing was bought, at the level a shopper "
    "compares prices across stores: the type, not the variety, flavour, brand, "
    "size, packaging, or quality label such as Bio. So Reis for any rice, Aufstrich "
    "for any bread spread, Joghurt for any yoghurt including plant-based ones, "
    "Nudeln for any dry pasta, Käse for any cheese that is not cream cheese "
    "including Mozzarella and Halloumi, Frischkäse for cream cheese and Crème "
    "fraîche, Limonade for any soft drink including cola, Energydrink for any drink "
    "sold for its caffeine or energy, Saft, Smoothie, Schokolade, Chips. A "
    "sandwich, wrap, or other ready-made snack is Sandwich, never Brot. Keep kinds "
    "apart when they are bought for different uses or differ clearly in price: "
    "Milch and Haferdrink, Brot and Brötchen, Käse and Frischkäse, Saft and "
    "Smoothie, Joghurt and Zaziki, Bier and Malzbier, Tofu and Veganes Hack. "
    "Fresh fruit and "
    "vegetables keep their kind: Tomaten, Cherrytomaten, Champignons, Zucchini. "
    "Dishes and drinks served in restaurants, cafés, and bars are named by their "
    "type as served, such as Burger, Pommes, Nudelgericht, Cocktail, Bier vom Fass, "
    "Kaffee, never with the name of a grocery such as Nudeln or Bier. Medicines and "
    "drugstore goods use their common type, such as Hautgel or Nahrungsergänzung. "
    "Use German names."
)


def _instructions_for_feature(feature: str, output_type: type) -> str:
    common = (
        "Return only data matching the requested schema. Do not invent categories, "
        "tags, ids, dates, or amounts. Use only ids and labels present in the payload. "
        "Keep the answer concise."
    )
    if feature == "transaction_triage":
        return (
            common
            + " Suggest a category, tags, and optional title cleanup for the single "
            "Uncategorized transaction. Keep clean_title non-empty by preserving the "
            "current title unless a clearer merchant title is obvious. Choose the best "
            "category when the evidence is sufficient; use null only for genuinely "
            "ambiguous transactions and explain the uncertainty in reason. Do not "
            "request writes."
        )
    if feature == "rule_mining":
        return (
            common
            + " Propose deterministic title-based rules only when the supplied evidence "
            "shows repeated user-confirmed classification behavior. Return proposals [] "
            "when there is no actionable repeated pattern. Every proposal must include "
            "evidence_transaction_ids from the payload, a title match_value derived from "
            "the repeated merchant token, and either set_category_id or add_tags."
        )
    if output_type is ProductMergesOutput:
        return (
            common + " You keep the product names of one household's receipt items "
            "consistent. The payload maps each product name to how many items use "
            "it, some of their labels as printed on receipts, and whether the owner "
            "named it. A name the owner named is never merged away; other names may "
            "be merged into it. "
            + PRODUCT_NAME_RULE
            + " Return a merge for every group of names that this rule makes one "
            "product, such as a variety and its type: names are the names merged "
            "away, into the name they all take, which may be one of them or a new "
            "name. Merge only names from the payload, each into one name. Never "
            "merge different kinds of product: two different fruits or vegetables, "
            "a fresh food and a preserved or dried one, or a food and a dish made "
            "from it stay apart, and so does every pair the rule keeps apart. When "
            "unsure, leave the names apart. Return merges [] when every name "
            "already fits."
        )
    if feature == "receipt_items":
        return (
            common + " Read the attached image into the lines of what was bought. Any "
            "document that shows bought items with prices counts, such as a till "
            "receipt, a restaurant bill, an invoice, or a pharmacy prescription "
            "with its price. Set is_receipt false and items [] when the image shows "
            "no prices for bought items or cannot be read. total_cents is the total "
            "printed on it, or null when none is legible. Amounts are integer cents "
            "in the document's currency. List every purchased line in printed order "
            "with label as printed and amount_cents as the line's total. A "
            "quantity line such as 2 X 5,90 belongs to the line whose amount is that "
            "quantity times that price, even when printed next to another line. A "
            "discount printed directly under a line belongs to that line: subtract "
            "it from that line's amount_cents. Discounts or coupons on the whole "
            "receipt are kind discount with a negative amount_cents. Bottle deposits "
            "are kind deposit, and deposit returns are deposit lines with a negative "
            "amount_cents. Never list subtotals, totals, tax summaries, payment, "
            "change, tips written by hand, or loyalty lines. quantity and unit are "
            "the printed count or weight, such as 2 pcs or 0.532 kg, and "
            "unit_price_cents the printed price per unit; leave them null when none "
            "is printed. "
            + PRODUCT_NAME_RULE
            + " Work out abbreviated labels from what the store sells. When the "
            "payload's products list holds a name for this kind of product, use "
            "exactly that name."
        )
    return common
