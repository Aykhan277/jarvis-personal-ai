
"""Local wake-word detection using openWakeWord and sounddevice."""

from __future__ import annotations

import threading
import time

import numpy as np
from openwakeword.model import Model


class WakeWordDetector:
    """Listen for the Hey Jarvis wake word."""

    def __init__(
        self,
        *,
        device: int = 1,
        sample_rate: int = 16000,
        chunk_size: int = 1280,
        threshold: float = 0.35,
        rearm_threshold: float = 0.05,
        rearm_seconds: float = 1.0,
    ) -> None:
        self.device = device
        self.sample_rate = sample_rate
        self.chunk_size = chunk_size
        self.threshold = threshold
        self.rearm_threshold = rearm_threshold
        self.rearm_seconds = rearm_seconds

        self.model = Model(
            wakeword_models=["hey_jarvis"],
            inference_framework="onnx",
        )

        self._armed = True
        self._below_threshold_since: float | None = None

    def wait_for_wake_word(
        self,
        stop_event: threading.Event | None = None,
    ) -> bool:
        """Block until the wake word is detected or stop is requested."""

        import sounddevice as sd

        if stop_event is None:
            stop_event = threading.Event()

        with sd.RawInputStream(
            device=self.device,
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
            blocksize=self.chunk_size,
        ) as stream:
            while not stop_event.is_set():
                raw, overflowed = stream.read(self.chunk_size)

                if overflowed:
                    continue

                audio = np.frombuffer(raw, dtype=np.int16)
                prediction = self.model.predict(audio)
                score = float(prediction.get("hey_jarvis", 0.0))

                now = time.monotonic()

                # Require a sustained low score before re-arming.
                if not self._armed:
                    if score <= self.rearm_threshold:
                        if self._below_threshold_since is None:
                            self._below_threshold_since = now
                        elif (
                            now - self._below_threshold_since
                            >= self.rearm_seconds
                        ):
                            self._armed = True
                            self._below_threshold_since = None
                    else:
                        self._below_threshold_since = None

                    continue

                if score >= self.threshold:
                    self._armed = False
                    self._below_threshold_since = None
                    return True

        return False


__all__ = ["WakeWordDetector"]
