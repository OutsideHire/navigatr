/**
 * navigatr canonical design-system components.
 *
 * Everything in this folder is a Figma-fidelity component sourced from the
 * `navigatr v1` Figma file. Feature code imports from here, NOT from
 * `components/ui/` (those are raw shadcn primitives).
 */

export { Button } from "./Button";
export type { ButtonProps } from "./Button";

export { FormField } from "./FormField";
export type { FormFieldProps } from "./FormField";
export { useFormField } from "./FormFieldContext";
export type { FormFieldContextValue } from "./FormFieldContext";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Textarea } from "./Textarea";
export type { TextareaProps } from "./Textarea";

export { Select } from "./Select";
export type { SelectProps, SelectOption } from "./Select";

export { Checkbox } from "./Checkbox";
export type { CheckboxProps } from "./Checkbox";

export { Card } from "./Card";
export type { CardProps } from "./Card";

export { CardWithStatusBand } from "./CardWithStatusBand";
export type { CardWithStatusBandProps, BandColor } from "./CardWithStatusBand";

export { KpiCard } from "./KpiCard";
export type { KpiCardProps, KpiAccent, KpiSize, KpiTrend } from "./KpiCard";

export { ListRow } from "./ListRow";
export type { ListRowProps } from "./ListRow";

// Session 9 — atoms
export { Badge } from "./Badge";
export type { BadgeProps, BadgeKind } from "./Badge";

export { Avatar } from "./Avatar";
export type { AvatarProps, AvatarSize, AvatarShape, AvatarStatus } from "./Avatar";

export { Chip } from "./Chip";
export type { ChipProps } from "./Chip";

export { PhoneWithClickToCall } from "./PhoneWithClickToCall";
export type {
  PhoneWithClickToCallProps,
  PhoneSize,
  AlternateNumber,
} from "./PhoneWithClickToCall";

export { NotesFieldWithMic } from "./NotesFieldWithMic";
export type { NotesFieldWithMicProps, MicState } from "./NotesFieldWithMic";

export { DispositionTile } from "./DispositionTile";
export type { DispositionTileProps, DispositionTier } from "./DispositionTile";
