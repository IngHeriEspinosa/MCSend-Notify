'use client';

/** Selección múltiple accesible (Autocomplete de MUI) a partir de opciones id/etiqueta. */
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';

export interface MultiSelectOption {
  id: string;
  label: string;
}

interface MultiSelectFieldProps {
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  helperText?: string | undefined;
  error?: boolean;
  disabled?: boolean;
}

export function MultiSelectField({
  label,
  options,
  value,
  onChange,
  helperText,
  error = false,
  disabled = false,
}: MultiSelectFieldProps) {
  return (
    <Autocomplete
      multiple
      options={options}
      value={options.filter((option) => value.includes(option.id))}
      onChange={(_event, selected) => onChange(selected.map((option) => option.id))}
      getOptionLabel={(option) => option.label}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      disabled={disabled}
      filterSelectedOptions
      renderInput={(params) => (
        <TextField {...params} label={label} helperText={helperText} error={error} />
      )}
    />
  );
}
