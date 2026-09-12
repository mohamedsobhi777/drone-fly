"""Engineered visual features from actual gimbal-camera RGB pixels.

The active gate is painted orange by the task. A color threshold estimates its
image bounding box. This is an explicit fiducial task, not semantic vision.
No world coordinates or segmentation IDs enter the navigation observation.
"""
import numpy as np

CHANNELS = ["Gate horizontal", "Gate vertical", "Gate width", "Gate height",
            "Gate visible", "Forward velocity", "Lateral velocity", "Vertical velocity"]


def encode(image, velocity, intervention="none"):
    pixels = np.asarray(image).copy()
    if pixels.ndim != 3 or pixels.shape[2] != 3:
        raise ValueError("Expected RGB camera image")
    if intervention == "blind":
        pixels[:] = 0
    elif intervention == "left-eye":
        pixels[:, :pixels.shape[1] // 2] = 0
    r, g, b = pixels.astype(float).transpose(2, 0, 1)
    mask = (r > 65) & (r > g * 1.7) & (r > b * 1.7)
    ys, xs = np.nonzero(mask)
    h, w = pixels.shape[:2]
    bbox = None
    visible = len(xs) >= 5
    if visible:
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        cx = (x0 + x1) / (w - 1) - 1
        cy = 1 - (y0 + y1) / (h - 1)
        width, height = (x1 - x0) / w, (y1 - y0) / h
        bbox = [x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h]
    else:
        cx, cy, width, height = 0., 0., 0., 0.
    v = np.asarray(velocity)
    values = np.array([cx, cy, width, height, float(visible), v[0] / 2, v[1] / 2, v[2] / 1.5])
    return np.clip(values, -1, 1), {"bbox": bbox, "pixels": int(len(xs)), "visible": bool(visible)}, pixels


def visual_servo(observation):
    """Documented conventional teacher, using the same eight observations."""
    x, y, width, height, visible, vx, vy, vz = observation
    if visible < .5:
        return np.array([1.0, 0., 0.])
    return np.array([1.15 - .35 * min(1., abs(x) + abs(y)),
                     np.clip(-4.8 * x, -1.7, 1.7), np.clip(3.8 * y, -1.2, 1.2)])

