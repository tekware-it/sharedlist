export type FlagConfig = {
  label: string;
  description?: string;
};

export type FlagsDefinition = {
  checked: FlagConfig;
  crossed: FlagConfig;
  highlighted: FlagConfig;
};

export type ListMeta = {
  name: string;
  flagsDefinition: FlagsDefinition;
};

export type FlagState = {
  checked: boolean;
  crossed: boolean;
  highlighted: boolean;
};

export type ListItemPlain = {
  label: string;
  flags: FlagState;
};
