import { useEffect, useState } from "react";

/** Native macOS fullscreen is independent of the browser Fullscreen API. */
export function useWindowFullscreen() {
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    const bridge = window.showai;
    if (!bridge?.getWindowState || !bridge.onWindowStateChange) return;
    let active = true;
    let receivedChange = false;
    const unsubscribe = bridge.onWindowStateChange((state) => {
      receivedChange = true;
      setFullScreen(state.fullScreen);
    });
    void bridge.getWindowState().then((state) => {
      if (active && !receivedChange) setFullScreen(state.fullScreen);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return fullScreen;
}
