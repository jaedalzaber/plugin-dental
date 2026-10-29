// A list of short texts (medications, manual alerts): chips with a remove button and one input to add more.

import { useState } from "react";
import { Plus, X } from "@appointit/ui/icons";
import { Button, Input } from "@appointit/ui";

export function ListEditor({
  id,
  items,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
  emptyText,
  disabled,
  maxItems,
}: {
  id: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  addLabel: string;
  /** Label for one remove button; receives the item text. */
  removeLabel: (item: string) => string;
  emptyText: string;
  disabled?: boolean;
  maxItems: number;
}) {
  const [text, setText] = useState("");

  function add() {
    const value = text.trim();
    if (!value || items.length >= maxItems) return;
    if (!items.some((item) => item.toLowerCase() === value.toLowerCase())) onChange([...items, value]);
    setText("");
  }

  return (
    <div className="grid gap-2">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-3 text-sm">
              <span>{item}</span>
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={removeLabel(item)}
                  onClick={() => onChange(items.filter((x) => x !== item))}
                  className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {disabled ? null : (
        <div className="flex gap-2">
          <Input
            id={id}
            value={text}
            maxLength={200}
            placeholder={placeholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={add} disabled={text.trim() === ""}>
            <Plus aria-hidden="true" />
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
