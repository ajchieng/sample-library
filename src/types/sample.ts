export type SampleType =
  | "loop"
  | "one-shot"
  | "drum"
  | "vocal"
  | "instrument"
  | "fx"
  | "texture"
  | "other";

export const SAMPLE_TYPES: SampleType[] = [
  "loop",
  "one-shot",
  "drum",
  "vocal",
  "instrument",
  "fx",
  "texture",
  "other",
];

export type Sample = {
  id: number;
  name: string;
  original_filename?: string;
  file_path: string;
  bpm?: number;
  musical_key?: string;
  type?: SampleType;
  mood?: string;
  source?: string;
  notes?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

/** Editable metadata fields (everything except identity / timestamps). */
export type SampleMetadata = {
  name: string;
  bpm: number | null;
  musical_key: string | null;
  type: SampleType | null;
  mood: string | null;
  source: string | null;
  notes: string | null;
};
