import * as React from "react";
import { Plus, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Checkbox } from "@/components/navigatr";
import { CATEGORY_LABEL, type MerchantCategory } from "../mockData";
import {
  RECOMMENDED_SELECTION, allSubtypes, selectedCategories, subtypeCount,
  humanizeSubtype, type IndustrySelection,
} from "../lib/industrySelection";

interface IndustryEditorProps {
  value: IndustrySelection;
  scope: "path" | "default";
  onUseForPath: (sel: IndustrySelection) => void;
  onSaveDefault: (sel: IndustrySelection) => void;
}

const ALL_CATEGORIES = (Object.keys(CATEGORY_LABEL) as MerchantCategory[]).filter((c) => c !== "other");

/**
 * IndustryEditor — picks-first (approach A). Shows only the rep's selected
 * industries (expandable to sub-types); "Add industries" reveals a picker of the
 * rest. Local working copy; the footer actions hand the selection up.
 */
export function IndustryEditor({ value, scope, onUseForPath, onSaveDefault }: IndustryEditorProps) {
  const [sel, setSel] = React.useState<IndustrySelection>(value);
  const [adding, setAdding] = React.useState(false);
  const [expanded, setExpanded] = React.useState<MerchantCategory | null>(null);

  const chosen = selectedCategories(sel);
  const addable = ALL_CATEGORIES.filter((c) => !chosen.includes(c));

  const addCategory = (c: MerchantCategory) => {
    setSel((s) => ({ ...s, [c]: allSubtypes(c) }));
    setAdding(false);
  };
  const removeCategory = (c: MerchantCategory) =>
    setSel((s) => { const next = { ...s }; delete next[c]; return next; });
  const toggleSubtype = (c: MerchantCategory, t: string) =>
    setSel((s) => {
      const cur = s[c] ?? [];
      const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
      if (next.length === 0) { const cp = { ...s }; delete cp[c]; return cp; }
      return { ...s, [c]: next };
    });

  return (
    <div className="flex flex-col gap-3">
      {chosen.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-radius-md border border-dashed border-border-default p-4">
          <p className="text-body-md text-text-muted">Add the industries you sell to.</p>
          <Button variant="secondary" size="sm" onClick={() => setSel(RECOMMENDED_SELECTION)}>
            Use Recommended
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {chosen.map((c) => {
            const { selected, total } = subtypeCount(sel, c);
            const isOpen = expanded === c;
            return (
              <div key={c} className="rounded-radius-md border border-border-default">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button type="button" onClick={() => setExpanded(isOpen ? null : c)}
                    aria-expanded={isOpen}
                    aria-controls={`subtype-panel-${c}`}
                    aria-label={`Toggle ${CATEGORY_LABEL[c]} sub-types`}
                    className="flex flex-1 items-center justify-between text-left">
                    <span className="text-body-md font-medium text-text-default">{CATEGORY_LABEL[c]}</span>
                    <span className="flex items-center gap-1 text-caption text-text-muted">
                      {selected} of {total}
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
                    </span>
                  </button>
                  <button type="button" aria-label={`Remove ${CATEGORY_LABEL[c]}`} onClick={() => removeCategory(c)}
                    className="rounded-radius-sm p-1 text-text-muted hover:text-status-danger">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                {isOpen && (
                  <div id={`subtype-panel-${c}`} className="flex flex-col gap-2 border-t border-border-default px-3 py-3">
                    {allSubtypes(c).map((t) => (
                      <Checkbox
                        key={t}
                        label={humanizeSubtype(t)}
                        checked={(sel[c] ?? []).includes(t)}
                        onCheckedChange={() => toggleSubtype(c, t)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="flex flex-col gap-1 rounded-radius-md border border-border-default p-2">
          <span className="px-1 text-caption font-medium text-text-muted">Add an industry</span>
          {addable.map((c) => (
            <button key={c} type="button" onClick={() => addCategory(c)}
              className="rounded-radius-sm px-2 py-2 text-left text-body-md text-text-default hover:bg-surface-sunken">
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      ) : (
        <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={() => setAdding(true)} className="self-start">
          Add industries
        </Button>
      )}

      <div className="flex gap-2 pt-1">
        {scope === "path" ? (
          <>
            <Button variant="primary" className="flex-1" onClick={() => onUseForPath(sel)}>Use for this path</Button>
            <Button variant="secondary" onClick={() => onSaveDefault(sel)}>Save as default</Button>
          </>
        ) : (
          <Button variant="primary" className="flex-1" onClick={() => onSaveDefault(sel)}>Save</Button>
        )}
      </div>
    </div>
  );
}
