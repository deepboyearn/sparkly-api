import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "./ui";
import { Icon } from "@iconify/react";

export function ModelPicker({
  label,
  value,
  models,
  query,
  onQueryChange,
  onSelect,
  footerLeft,
  footerRight,
}: {
  label?: string;
  value: string;
  models: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (value: string) => void;
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredModels = useMemo(() => (
    models.filter((model) => model.toLowerCase().includes(normalizedQuery))
  ), [models, normalizedQuery]);

  // When closed (default), show only the selected model (or first model)
  // When isOpen is true or query is typed, expand to show all filtered models
  const displayedModels = useMemo(() => {
    if (isOpen || normalizedQuery) {
      return filteredModels;
    }
    const selected = filteredModels.find((m) => m === value);
    return selected ? [selected] : filteredModels.slice(0, 1);
  }, [filteredModels, isOpen, normalizedQuery, value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="full-width model-picker-field">
      <Input
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        placeholder="Search model..."
        className="model-picker-search"
        onFocus={() => {
          if (!isOpen) setIsOpen(true);
        }}
      />
      <div className="picker-list">
        {displayedModels.length === 0 ? <div className="picker-empty">No matching models</div> : null}
        {displayedModels.map((model) => (
          <button
            key={model}
            type="button"
            className={`picker-item ${model === value ? "active-picker-item" : ""}`}
            onClick={() => {
              if (!isOpen) {
                setIsOpen(true);
              } else {
                onSelect(model);
                setIsOpen(false);
              }
            }}
          >
            <span>{model}</span>
            {model === value ? <Icon icon="solar:check-circle-bold-duotone" className="picker-item-icon" /> : null}
          </button>
        ))}
      </div>
      {(footerLeft || footerRight) && (
        <div className="actions-row" style={{ display: "flex", justifyContent: footerLeft ? "space-between" : "flex-end", alignItems: "center", width: "100%", marginTop: "12px" }}>
          {footerLeft && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              {footerLeft}
            </div>
          )}
          {footerRight && (
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {footerRight}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
