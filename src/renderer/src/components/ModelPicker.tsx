import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "./ui";
import { Icon } from "@iconify/react";

const MODEL_PAGE_SIZE = 100;

export function ModelPicker({
  label,
  value,
  models,
  query,
  onQueryChange,
  onSelect,
  onClear,
  footerLeft,
  footerRight,
  popover = false,
}: {
  label?: string;
  value: string;
  models: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (value: string) => void;
  onClear?: () => void;
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;
  popover?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(MODEL_PAGE_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = (model: string) => model.split("/").filter(Boolean).pop() || model;
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredModels = useMemo(() => (
    models.filter((model) => model.toLowerCase().includes(normalizedQuery))
  ), [models, normalizedQuery]);

  // Filtering always covers the complete provider catalog. Rendering is paged
  // in batches so large catalogs remain responsive without hiding later hits.
  const displayedModels = useMemo(() => {
    if (!isOpen && !normalizedQuery) {
      const selected = filteredModels.find((model) => model === value);
      return selected ? [selected] : filteredModels.slice(0, 1);
    }
    return filteredModels.slice(0, visibleCount);
  }, [filteredModels, isOpen, normalizedQuery, value, visibleCount]);
  const hasMore = displayedModels.length < filteredModels.length;

  useEffect(() => {
    setVisibleCount(MODEL_PAGE_SIZE);
  }, [normalizedQuery, models]);

  const loadNextPage = useCallback(() => {
    setVisibleCount((current) => Math.min(current + MODEL_PAGE_SIZE, filteredModels.length));
  }, [filteredModels.length]);

  const handleListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!hasMore) return;
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining <= 48) loadNextPage();
  }, [hasMore, loadNextPage]);

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
    <div ref={containerRef} className={`full-width model-picker-field ${popover ? "model-picker-popover" : ""}`}>
      {label ? <span className="model-picker-label">{label}</span> : null}
      <div style={{ position: "relative", width: "100%" }}>
        <Input
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          placeholder="Search short or full model ID..."
          className="model-picker-search"
          style={{ paddingRight: query ? "36px" : "14px" }}
          onFocus={() => {
            if (!isOpen) setIsOpen(true);
          }}
        />
        {query ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQueryChange("");
              if (onClear) onClear();
            }}
            style={{
              position: "absolute",
              right: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "#a1a1aa",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px",
              borderRadius: "50%",
              transition: "color 0.2s ease",
              zIndex: 2,
            }}
            title="Clear selection"
          >
            <Icon icon="solar:close-circle-bold" style={{ fontSize: "16px" }} />
          </button>
        ) : null}
      </div>
      {(!popover || isOpen) ? (
        <div className="model-picker-summary" role="status">
          <span>{models.length.toLocaleString()} provider models</span>
          {filteredModels.length !== models.length ? <span>{filteredModels.length.toLocaleString()} matches</span> : null}
          {isOpen || normalizedQuery ? (
            <span>Loaded {displayedModels.length.toLocaleString()} of {filteredModels.length.toLocaleString()}</span>
          ) : null}
        </div>
      ) : null}
      {(!popover || isOpen) ? <div
        className="picker-list"
        role="listbox"
        aria-label={label || "Provider models"}
        onScroll={handleListScroll}
      >
        {models.length === 0 ? <div className="picker-empty">No provider models loaded. Scan the active account first.</div> : null}
        {models.length > 0 && displayedModels.length === 0 ? <div className="picker-empty">No matching models</div> : null}
        {displayedModels.map((model) => (
          <button
            key={model}
            type="button"
            className={`picker-item ${model === value ? "active-picker-item" : ""}`}
            role="option"
            aria-selected={model === value}
            onClick={() => {
              if (!isOpen) {
                setIsOpen(true);
              } else {
                onSelect(model);
                setIsOpen(false);
              }
            }}
          >
            <span className="picker-model-copy">
              <strong>{displayName(model)}</strong>
              <small>{model}</small>
            </span>
            {model === value ? <Icon icon="solar:check-circle-bold-duotone" className="picker-item-icon" /> : null}
          </button>
        ))}
      </div> : null}
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
