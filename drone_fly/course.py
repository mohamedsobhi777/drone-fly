"""Seeded, fully specified courses shared by physics and the browser."""

from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class Gate:
    x: float
    y: float
    z: float
    width: float = 2.0
    height: float = 1.8


@dataclass(frozen=True)
class Obstacle:
    x: float
    y: float
    z: float
    radius: float = 0.24
    height: float = 3.2


@dataclass(frozen=True)
class Course:
    seed: int
    difficulty: str
    gates: tuple[Gate, ...]
    obstacles: tuple[Obstacle, ...]
    length: float
    width: float = 10.0
    height: float = 5.0

    def payload(self):
        return asdict(self)


def make_course(seed: int, difficulty: str = "standard") -> Course:
    if difficulty not in {"standard", "slalom", "gusts"}:
        raise ValueError("Unknown course difficulty")
    rng = np.random.default_rng(seed)
    spread = 1.25 if difficulty != "slalom" else 1.9
    gates = tuple(
        Gate(5.0 + i * 5.5, float(rng.uniform(-spread, spread)), float(rng.uniform(1.35, 2.25)))
        for i in range(5)
    )
    # Pillars flank the flight corridor. Gate frames are the primary obstacles.
    obstacles = tuple(
        Obstacle(7.5 + i * 5.5, float(side * rng.uniform(3.3, 4.0)), 1.6)
        for i in range(4)
        for side in (-1, 1)
    )
    return Course(seed, difficulty, gates, obstacles, gates[-1].x + 5)
