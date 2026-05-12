/**
 * FormField context — split out from FormField.tsx so react-refresh's
 * "only export components" rule stays satisfied while still letting child
 * inputs read field state without prop-passing.
 */

import { createContext, useContext } from "react";

export interface FormFieldContextValue {
  inputId: string;
  helperId: string;
  isInvalid: boolean;
  isDisabled: boolean;
  isRequired: boolean;
}

export const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/**
 * Read FormField context from a child input. Returns null when used
 * standalone — components should fall back to their own props.
 */
export function useFormField(): FormFieldContextValue | null {
  return useContext(FormFieldContext);
}
