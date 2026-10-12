"""Small TF-IDF neighbor classifier; training and inference use the standard library."""

import math
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel

MAX_HISTORY = 2000
MIN_HISTORY = 60
MAX_TERMS = 12000


@dataclass(frozen=True)
class Example:
    title: str
    amount_cents: int
    latitude: float | None
    longitude: float | None
    category_id: int


class Neighbor(BaseModel):
    category_id: int
    log_amount: float
    latitude: float | None
    longitude: float | None


class Prediction(BaseModel):
    category_id: int
    confidence: float
    eligible: bool


def grams(title: str) -> Counter[str]:
    text = unicodedata.normalize("NFKC", title[:512]).casefold()
    text = re.sub(r"\d{3,}", " # ", text)
    counts: Counter[str] = Counter()
    for word in text.split():
        padded = f" {word} "
        for size in range(3, 6):
            for offset in range(max(1, len(padded) - size + 1)):
                counts[padded[offset : offset + size]] += 1
            if len(padded) <= size:
                break
    return counts


def scaled_probabilities(probabilities: list[float], temperature: float) -> list[float]:
    logits = [math.log(max(p, 1e-12)) / temperature for p in probabilities]
    largest = max(logits)
    values = [math.exp(logit - largest) for logit in logits]
    total = sum(values)
    return [value / total for value in values]


class CategoryModel(BaseModel):
    version: Literal[1] = 1
    classes: list[int]
    support: list[int]
    terms: dict[str, tuple[float, list[tuple[int, float]]]]
    neighbors: list[Neighbor]
    temperature: float = 1.0

    def distribution(self, row: Example) -> tuple[list[float], float]:
        weighted = [
            (self.terms[term], (1 + math.log(count)) * self.terms[term][0])
            for term, count in grams(row.title).items()
            if term in self.terms
        ]
        norm = math.sqrt(sum(value * value for _, value in weighted)) or 1
        similarities = [0.0] * len(self.neighbors)
        for (_, postings), value in weighted:
            for index, past_value in postings:
                similarities[index] += value / norm * past_value
        scores = similarities.copy()
        log_amount = math.log1p(max(row.amount_cents, 0) / 100)
        for index, past in enumerate(self.neighbors):
            scores[index] *= math.exp(-0.5 * abs(log_amount - past.log_amount))
            if (
                row.latitude is not None
                and row.longitude is not None
                and past.latitude is not None
                and past.longitude is not None
            ):
                distance = math.hypot(
                    (row.latitude - past.latitude) * 111,
                    (row.longitude - past.longitude) * 75,
                )
                scores[index] *= 0.5 + 0.5 * math.exp(-distance)
        total_support = sum(self.support) + 0.1 * len(self.classes)
        votes = {
            category: 0.1 * (count + 0.1) / total_support
            for category, count in zip(self.classes, self.support, strict=True)
        }
        for index in sorted(range(len(scores)), key=lambda i: -scores[i])[:3]:
            votes[self.neighbors[index].category_id] += max(0, scores[index]) ** 3
        total = sum(votes.values())
        return [votes[category] / total for category in self.classes], max(
            similarities, default=0
        )

    def predict(self, row: Example) -> Prediction:
        raw, similarity = self.distribution(row)
        probabilities = scaled_probabilities(raw, self.temperature)
        index = max(range(len(probabilities)), key=probabilities.__getitem__)
        return Prediction(
            category_id=self.classes[index],
            confidence=probabilities[index],
            eligible=self.support[index] >= 5 and similarity >= 0.25,
        )


def fit_neighbors(rows: list[Example], classes: list[int]) -> CategoryModel:
    term_frequency: Counter[str] = Counter()
    for row in rows:
        term_frequency.update(grams(row.title))
        if len(term_frequency) > 2 * MAX_TERMS:
            # Bound temporary vocabulary too; later recurring terms can re-enter.
            retained = sorted(
                term_frequency, key=lambda term: (-term_frequency[term], term)
            )[:MAX_TERMS]
            term_frequency = Counter({term: term_frequency[term] for term in retained})
    vocabulary = sorted(term_frequency, key=lambda term: (-term_frequency[term], term))[
        :MAX_TERMS
    ]
    term_frequency.clear()
    document_frequency = Counter({term: 0 for term in vocabulary})
    for row in rows:
        document_frequency.update(
            term for term in grams(row.title) if term in document_frequency
        )
    idf = {
        term: math.log((1 + len(rows)) / (1 + document_frequency[term])) + 1
        for term in vocabulary
    }
    postings: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for index, row in enumerate(rows):
        weights = {
            term: (1 + math.log(count)) * idf[term]
            for term, count in grams(row.title).items()
            if term in idf
        }
        norm = math.sqrt(sum(value * value for value in weights.values())) or 1
        for term, value in weights.items():
            postings[term].append((index, value / norm))
    support = Counter(row.category_id for row in rows)
    return CategoryModel(
        classes=classes,
        support=[support[category] for category in classes],
        terms={term: (idf[term], postings[term]) for term in vocabulary},
        neighbors=[
            Neighbor(
                category_id=row.category_id,
                log_amount=math.log1p(max(row.amount_cents, 0) / 100),
                latitude=row.latitude,
                longitude=row.longitude,
            )
            for row in rows
        ],
    )


def train(rows: list[Example]) -> CategoryModel | None:
    """Calibrate on forward-only predictions, then fit the final index on all rows."""
    classes = sorted({row.category_id for row in rows})
    if len(rows) < MIN_HISTORY or len(classes) < 2:
        return None
    calibration: list[tuple[list[float], int]] = []
    count = min(120, len(rows) // 3)
    start = len(rows) - count
    block = max(1, count // 4)
    for offset in range(start, len(rows), block):
        model = fit_neighbors(rows[:offset], classes)
        for row in rows[offset : offset + block]:
            probabilities, _ = model.distribution(row)
            calibration.append((probabilities, classes.index(row.category_id)))

    def loss(log_temperature: float) -> float:
        temperature = math.exp(log_temperature)
        return -sum(
            math.log(
                max(scaled_probabilities(probabilities, temperature)[target], 1e-12)
            )
            for probabilities, target in calibration
        )

    # Bounded golden-section search for the same scalar temperature fit used in
    # the research campaign, without scipy/numpy in the production process.
    left, right = -2.3, 2.3
    ratio = (math.sqrt(5) - 1) / 2
    for _ in range(40):
        a, b = right - ratio * (right - left), left + ratio * (right - left)
        if loss(a) < loss(b):
            right = b
        else:
            left = a
    model = fit_neighbors(rows, classes)
    model.temperature = math.exp((left + right) / 2)
    return model


@lru_cache(maxsize=4)
def load_model(model_json: str) -> CategoryModel:
    return CategoryModel.model_validate_json(model_json)
