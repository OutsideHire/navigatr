/**
 * SpokeToField — "Who did you speak to?", asked at the door.
 *
 * WHY THIS IS ONE COMPONENT AND NOT TWO COPIES. A rep logs a drop-in from two
 * different sheets: DropInSheet for a business that is not a deal yet, and
 * LogActivitySheet for a stop they already owed a visit to. Those two have
 * drifted apart twice before (the outcome list, then the follow-up timing), and
 * both times the fix landed on the sheet reps use LESS. Sharing the field is
 * the cheapest way to stop that happening a third time.
 *
 * WHY IT EXISTS AT ALL. Until 2026-09-29 the drop-in wrote the BUSINESS name
 * into the deal's contact-name field, so 156 of 250 Path-created deals on
 * production carried a company masquerading as a person. That reads as filled
 * in, so nobody corrected it. The 94 that were corrected had a rep go back and
 * retype the name later, away from the moment they actually met them. Asking
 * here costs one field and catches it while the rep still remembers.
 *
 * Deliberately just a name. No job title: the outcome tile already records
 * whether they reached the owner or a gatekeeper, and a rep doing this in a car
 * outside a shop has a very small budget for typing.
 */
import { Input } from "@/components/navigatr";

export interface SpokeToFieldProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Distinguishes the two hosts so their labels never collide in the DOM. */
  id?: string;
}

export function SpokeToField({ value, onChange, disabled, id = "spoke-to" }: SpokeToFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-text-muted">
        Who did you speak to? (optional)
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Name of the person you met"
        disabled={disabled}
        autoComplete="off"
      />
    </div>
  );
}

export default SpokeToField;
