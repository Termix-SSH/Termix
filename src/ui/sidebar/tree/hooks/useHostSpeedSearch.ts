import { useRef, useState, type KeyboardEvent } from "react";

/** Keyboard search belongs to the focused host list, never to an editor or terminal. */
export function useHostSpeedSearch() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => {
    setOpen(false);
    setText("");
    setIndex(0);
  };
  const change = (value: string) => {
    setText(value);
    setIndex(0);
  };

  const onKeyDown = (
    event: KeyboardEvent,
    count: number,
    activate: (index: number) => void,
    restoreFocus: () => void,
  ) => {
    const target = event.target as HTMLElement;
    const inSearch = target === inputRef.current;
    if (
      (!inSearch &&
        target.closest("input, textarea, select, [contenteditable=true]")) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;
    const selected = Math.min(index, Math.max(0, count - 1));
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      restoreFocus();
    } else if (open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (count)
        setIndex(
          (selected + (event.key === "ArrowDown" ? 1 : -1) + count) % count,
        );
    } else if (open && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (count) activate(selected);
    } else if (!inSearch && event.key.length === 1 && event.key !== " ") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      change(open ? text + event.key : event.key === "/" ? "" : event.key);
    }
  };

  return { open, text, index, inputRef, change, close, onKeyDown };
}
