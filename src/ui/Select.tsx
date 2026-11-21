import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "./icons";
import "./select.css";

interface OptionItem {
  value: string;
  label: ReactNode;
  disabled: boolean;
  lang?: string;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textContent(node.props.children);
  return "";
}

function collectOptions(children: ReactNode, target: OptionItem[]) {
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    if (child.type === Fragment) {
      collectOptions(
        (child as ReactElement<{ children?: ReactNode }>).props.children,
        target,
      );
      continue;
    }
    if (child.type === "option") {
      const props = (
        child as ReactElement<{
          value?: string | number;
          disabled?: boolean;
          lang?: string;
          children?: ReactNode;
        }>
      ).props;
      const value =
        props.value !== undefined ? String(props.value) : textContent(props.children);
      target.push({
        value,
        label: props.children ?? value,
        disabled: !!props.disabled,
        lang: props.lang,
      });
    }
  }
}

export interface SelectProps {
  id?: string;
  className?: string;
  style?: CSSProperties;
  value?: string | number;
  defaultValue?: string | number;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  lang?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "data-autofocus"?: boolean | "";
  children?: ReactNode;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  ref?: Ref<HTMLButtonElement>;
}

export default function Select({
  id,
  className = "",
  style,
  value,
  defaultValue,
  disabled = false,
  required,
  title,
  lang,
  autoFocus,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "data-autofocus": dataAutofocus,
  children,
  onChange,
  ref,
}: SelectProps) {
  const options: OptionItem[] = [];
  collectOptions(children, options);

  const [uncontrolled, setUncontrolled] = useState(() =>
    defaultValue !== undefined ? String(defaultValue) : (options[0]?.value ?? ""),
  );
  const currentValue = value !== undefined ? String(value) : uncontrolled;
  const selectedIndex = options.findIndex((item) => item.value === currentValue);
  const displayOption =
    (selectedIndex >= 0 ? options[selectedIndex] : undefined) ?? options[0];

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const setTriggerRef = (node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref && typeof ref === "object")
      (ref as { current: HTMLButtonElement | null }).current = node;
  };

  const nextEnabled = (from: number, step: 1 | -1) => {
    if (!options.length) return -1;
    let index = from;
    for (let count = 0; count < options.length; count++) {
      index = (index + step + options.length) % options.length;
      if (!options[index].disabled) return index;
    }
    return -1;
  };

  const firstEnabled = () => options.findIndex((item) => !item.disabled);
  const lastEnabled = () => {
    for (let i = options.length - 1; i >= 0; i--)
      if (!options[i].disabled) return i;
    return -1;
  };

  const commit = (option: OptionItem) => {
    if (option.disabled) return;
    if (value === undefined) setUncontrolled(option.value);
    setOpen(false);
    triggerRef.current?.focus();
    if (option.value !== currentValue) {
      onChange?.({
        target: { value: option.value },
        currentTarget: { value: option.value },
      } as ChangeEvent<HTMLSelectElement>);
    }
  };

  const openMenu = () => {
    if (disabled || !options.length) return;
    const initial =
      selectedIndex >= 0 && !options[selectedIndex].disabled
        ? selectedIndex
        : firstEnabled();
    setActiveIndex(initial);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 4;
      const margin = 12;
      const below = window.innerHeight - rect.bottom - margin - gap;
      const above = rect.top - margin - gap;
      const placeAbove = below < 160 && above > below;
      const available = Math.max(120, Math.min(280, placeAbove ? above : below));
      const minWidth = Math.max(rect.width, 132);
      const maxWidth = Math.min(440, window.innerWidth - margin * 2);
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - Math.min(minWidth, maxWidth) - margin),
      );
      setMenuStyle({
        left,
        minWidth: Math.min(minWidth, maxWidth),
        maxWidth,
        maxHeight: available,
        ...(placeAbove
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
      });
    };
    updatePosition();
    const onScroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      )
        return;
      updatePosition();
    };
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) || menuRef.current?.contains(target))
      )
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    menuRef.current
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      [activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const hasOptions = options.some((item) => !item.disabled && item.value !== "");
  const isPlaceholder =
    !!displayOption && displayOption.disabled && displayOption.value === "";

  return (
    <>
      <button
        ref={setTriggerRef}
        type="button"
        role="combobox"
        id={id}
        className={`showai-select showai-custom-select ${className}`.trim()}
        style={style}
        disabled={disabled}
        title={title}
        lang={displayOption?.lang ?? lang}
        autoFocus={autoFocus}
        data-autofocus={dataAutofocus}
        data-required={required ? "true" : undefined}
        data-has-options={hasOptions ? "true" : "false"}
        data-placeholder={isPlaceholder ? "true" : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
        }
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (disabled) return;
          if (!open) {
            if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp" ||
              event.key === "Enter" ||
              event.key === " "
            ) {
              event.preventDefault();
              openMenu();
            }
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
            return;
          }
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) =>
              nextEnabled(index < 0 ? options.length - 1 : index, 1),
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => nextEnabled(index < 0 ? 0 : index, -1));
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            setActiveIndex(firstEnabled());
            return;
          }
          if (event.key === "End") {
            event.preventDefault();
            setActiveIndex(lastEnabled());
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const chosen = options[activeIndex];
            if (chosen && !chosen.disabled) commit(chosen);
          }
        }}
      >
        <span className="showai-select-label">{displayOption?.label ?? ""}</span>
        <ChevronDown
          size={15}
          className="showai-select-arrow"
          aria-hidden="true"
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            className="showai-select-menu"
            style={menuStyle}
            aria-label={ariaLabel}
          >
            {options.map((option, index) => {
              const selected = option.value === currentValue;
              return (
                <div
                  key={`${option.value}:${index}`}
                  id={`${listboxId}-opt-${index}`}
                  role="option"
                  lang={option.lang}
                  data-value={option.value}
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  className={`showai-select-option${index === activeIndex ? " is-active" : ""}${selected ? " is-selected" : ""}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => {
                    if (!option.disabled && activeIndex !== index)
                      setActiveIndex(index);
                  }}
                  onClick={() => commit(option)}
                >
                  <span className="showai-select-option-text">
                    {option.label}
                  </span>
                  {selected && (
                    <Check
                      size={14}
                      className="showai-select-option-check"
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
