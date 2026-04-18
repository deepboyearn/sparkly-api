import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Button, Chip, Input } from "@heroui/react";
import { Icon } from "@iconify/react";

const INITIAL_MODEL_PICKER_LIMIT = 40;

export function ModelPicker({
  label,
  value,
  models,
  query,
  onQueryChange,
  onSelect,
}: {
  label: string;
  value: string;
  models: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (value: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredModels = useMemo(() => (
    models.filter((model) => model.toLowerCase().includes(normalizedQuery))
  ), [models, normalizedQuery]);
  const visibleModels = useMemo(() => {
    if (normalizedQuery || isExpanded || filteredModels.length <= INITIAL_MODEL_PICKER_LIMIT) {
      return filteredModels;
    }

    const initialModels = filteredModels.slice(0, INITIAL_MODEL_PICKER_LIMIT);
    if (value && filteredModels.includes(value) && !initialModels.includes(value)) {
      return [value, ...initialModels.slice(0, INITIAL_MODEL_PICKER_LIMIT - 1)];
    }

    return initialModels;
  }, [filteredModels, isExpanded, normalizedQuery, value]);

  useEffect(() => {
    if (normalizedQuery) {
      setIsExpanded(true);
      return;
    }

    setIsExpanded(false);
  }, [normalizedQuery]);

  return (
    <div className="full-width model-picker-field">
      <div className="model-picker-header">
        <span>{label}</span>
        <Chip variant="soft" color="accent" className="model-picker-selected-chip">
          {value || "No model selected"}
        </Chip>
      </div>
      <Input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search model..."
        className="model-picker-search"
      />
      <div className="picker-list">
        {filteredModels.length === 0 ? <div className="picker-empty">No matching models</div> : null}
        {visibleModels.map((model) => (
          <button
            key={model}
            type="button"
            className={`picker-item ${model === value ? "active-picker-item" : ""}`}
            onClick={() => onSelect(model)}
          >
            <span>{model}</span>
            {model === value ? <Icon icon="solar:check-circle-bold-duotone" className="picker-item-icon" /> : null}
          </button>
        ))}
      </div>
      {!normalizedQuery && filteredModels.length > INITIAL_MODEL_PICKER_LIMIT ? (
        <div className="actions-row">
          <span className="panel-tag muted-tag">
            Showing {visibleModels.length} of {filteredModels.length} models
          </span>
          <Button variant="ghost" onPress={() => setIsExpanded((current) => !current)}>
            {isExpanded ? "Show less" : "Show all"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
