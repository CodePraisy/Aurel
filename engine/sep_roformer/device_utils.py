"""Small stand-ins for audio-separator's device helpers (CPU, CUDA and Apple GPUs)."""
from contextlib import nullcontext

import torch


def should_fallback_to_cpu_for_complex_ops(device: torch.device) -> bool:
    return device.type == "mps"


def autocast_disabled(device: torch.device):
    try:
        return torch.autocast(device_type=device.type, enabled=False)
    except (RuntimeError, TypeError, ValueError):
        return nullcontext()
