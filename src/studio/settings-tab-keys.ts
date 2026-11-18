import type { KeyboardEvent } from "react";

export function settingsTabKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      'button[role="tab"]:not(:disabled)',
    ),
  ];
  const index = tabs.indexOf(event.target as HTMLButtonElement);
  if (index < 0 || !tabs.length) return;
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + direction + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}
