import React from 'react';
import { Box, Button, FormControl, FormLabel, Typography } from '@mui/joy';

export interface ProviderTypeOption {
  value: string;
  label: string;
  description: string;
}

interface ProviderTypePickerProps {
  options: ProviderTypeOption[];
  onSelect: (providerType: string) => void;
}

export default function ProviderTypePicker({
  options,
  onSelect,
}: ProviderTypePickerProps) {
  return (
    <FormControl sx={{ mt: 2 }}>
      <FormLabel>Choose Compute Provider Type</FormLabel>
      <Typography level="body-sm" sx={{ mt: 0.5, color: 'text.tertiary' }}>
        Select a provider type to open its dedicated setup form.
      </Typography>
      <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {options.map((option) => (
          <Button
            key={option.value}
            variant="outlined"
            onClick={() => onSelect(option.value)}
            sx={{
              justifyContent: 'flex-start',
              textAlign: 'left',
              py: 1.2,
            }}
          >
            <Box>
              <Typography level="title-sm">{option.label}</Typography>
              <Typography level="body-sm" sx={{ color: 'text.tertiary' }}>
                {option.description}
              </Typography>
            </Box>
          </Button>
        ))}
      </Box>
    </FormControl>
  );
}
