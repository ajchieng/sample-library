export type SampleType =
  | "loop"
  | "one-shot"
  | "drum"
  | "vocal"
  | "instrument"
  | "fx"
  | "texture"
  | "song"
  | "beat"
  | "other";

export const SAMPLE_TYPES: SampleType[] = [
  "loop",
  "one-shot",
  "drum",
  "vocal",
  "instrument",
  "fx",
  "texture",
  "song",
  "beat",
  "other",
];

export type Sample = {
  id: number;
  name: string;
  original_filename?: string;
  /** Absolute path of the managed copy inside the library folder. */
  file_path: string;
  /** Absolute path the file was originally imported from; basis for duplicate
   * detection now that file_path always points at a fresh managed copy. */
  original_path?: string;
  bpm?: number;
  musical_key?: string;
  type?: SampleType;
  mood?: string;
  source?: string;
  notes?: string;
  tags: string[];
  is_favorite: boolean;
  /** Cached audio metadata from the file header; undefined until scanned. */
  duration_seconds?: number;
  sample_rate?: number;
  channels?: number;
  /** Exact-file duplicate metadata. The audio file is read only for hashing. */
  file_size?: number;
  content_hash?: string;
  hash_status?: "pending" | "ok" | "error";
  hash_error?: string;
  hash_updated_at?: string;
  /** Suggested musical metadata derived from read-only audio analysis. */
  detected_bpm?: number;
  detected_bpm_confidence?: number;
  detected_key?: string;
  detected_key_confidence?: number;
  analysis_status?: "pending" | "ok" | "error";
  analysis_error?: string;
  analysis_updated_at?: string;
  audio_fingerprint?: string;
  fingerprint_version?: number;
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
