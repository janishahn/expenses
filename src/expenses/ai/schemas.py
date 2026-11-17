from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class TransactionTriageOutput(BaseModel):
    category_id: int | None = None
    tags: list[str] = Field(default_factory=list)
    clean_title: str | None = Field(default=None, max_length=200)
    confidence: float = Field(..., ge=0, le=1)
    reason: str = Field(..., min_length=1, max_length=500)

    @model_validator(mode="after")
    def clean_tags(self):
        self.tags = _unique_names(self.tags)
        if self.clean_title is not None:
            self.clean_title = self.clean_title.strip() or None
        return self


class RuleProposalOut(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    match_type: Literal["contains", "equals", "starts_with", "regex"]
    match_value: str = Field(..., min_length=1, max_length=200)
    transaction_type: Literal["income", "expense"] | None = None
    min_amount_cents: int | None = Field(default=None, ge=0)
    max_amount_cents: int | None = Field(default=None, ge=0)
    set_category_id: int | None = None
    add_tags: list[str] = Field(default_factory=list)
    confidence: float = Field(..., ge=0, le=1)
    reason: str = Field(..., min_length=1, max_length=500)
    evidence_transaction_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_fields(self):
        self.name = self.name.strip()
        self.match_value = self.match_value.strip()
        self.add_tags = _unique_names(self.add_tags)
        self.evidence_transaction_ids = sorted(set(self.evidence_transaction_ids))
        return self


class RuleMiningOutput(BaseModel):
    proposals: list[RuleProposalOut] = Field(default_factory=list)


class ReceiptLineOut(BaseModel):
    label: str = Field(..., min_length=1, max_length=200)
    product: str = Field(..., min_length=1, max_length=80)
    kind: Literal["item", "discount", "deposit"]
    quantity: Decimal | None = Field(default=None, gt=0, lt=1_000_000)
    unit: str | None = Field(default=None, max_length=10)
    unit_price_cents: int | None = None
    amount_cents: int

    @model_validator(mode="after")
    def strip_names(self):
        self.label = self.label.strip()
        self.product = self.product.strip()
        if self.unit is not None:
            self.unit = self.unit.strip() or None
        return self


class ReceiptReadingOutput(BaseModel):
    is_receipt: bool
    total_cents: int | None = None
    items: list[ReceiptLineOut] = Field(default_factory=list, max_length=300)


class ProductMergeOut(BaseModel):
    names: list[str] = Field(..., min_length=1, max_length=50)
    into: str = Field(..., min_length=1, max_length=80)

    @model_validator(mode="after")
    def strip_names(self):
        self.into = self.into.strip()
        self.names = [name for name in _unique_names(self.names) if name != self.into]
        return self


class ProductMergesOutput(BaseModel):
    merges: list[ProductMergeOut] = Field(default_factory=list, max_length=100)


class RuleSuggestionResult(RuleProposalOut):
    id: int
    preview_matches_count: int


class TransactionSuggestionOut(BaseModel):
    id: int
    transaction_id: int
    status: str
    category_id: int | None = None
    category_name: str | None = None
    clean_title: str | None = None
    tags: list[str] = Field(default_factory=list)
    confidence: float
    reason: str


class RuleSuggestionOut(BaseModel):
    id: int
    status: str
    name: str
    match_type: str
    match_value: str
    transaction_type: str | None = None
    min_amount_cents: int | None = None
    max_amount_cents: int | None = None
    set_category_id: int | None = None
    set_category_name: str | None = None
    add_tags: list[str] = Field(default_factory=list)
    confidence: float
    reason: str
    evidence_transaction_ids: list[int] = Field(default_factory=list)
    preview_matches_count: int


def _unique_names(values: list[str]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for value in values:
        clean = value.strip()
        if not clean:
            continue
        lower = clean.lower()
        if lower in seen:
            continue
        seen.add(lower)
        names.append(clean)
    return names
