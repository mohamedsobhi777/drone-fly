"""Check stabilization, real camera encoding and a conventional visual pilot."""
from pathlib import Path
import time
from PIL import Image
from drone_fly.physics import Flight
from drone_fly.vision import encode, visual_servo

if __name__ == "__main__":
    start = time.perf_counter()
    Path(".local").mkdir(exist_ok=True)
    with Flight(render=False) as flight:
        for _ in range(200):
            flight.step([0, 0, 0])
        print("Hover:", flight.snapshot(), flush=True)
    with Flight(seed=42) as flight:
        for i in range(900):
            pixels = flight.observe()
            obs, vision, _ = encode(pixels, flight.velocity)
            if i == 0:
                Image.fromarray(pixels).save(".local/onboard.png")
                print("Camera:", obs, vision, flush=True)
            flight.step(visual_servo(obs))
            if i % 100 == 0:
                print(i, flight.snapshot(), flush=True)
            if flight.status != "flying":
                break
        print("Final:", flight.snapshot(), "wall seconds", time.perf_counter() - start, flush=True)

