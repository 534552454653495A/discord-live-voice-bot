"""Is the Chatterbox install healthy? Prints the torch, chatterbox and CUDA status."""
import sys

try:
    import torch

    print(f"torch: {torch.__version__} | cuda: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"gpu: {torch.cuda.get_device_name(0)}")
except Exception as err:  # the install may not have finished yet
    print(f"ERROR torch: {err}")
    sys.exit(1)

try:
    import chatterbox  # noqa: F401
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS  # noqa: F401

    print("chatterbox: ready (multilingual included)")
except Exception as err:
    print(f"ERROR chatterbox: {err}")
    sys.exit(1)
