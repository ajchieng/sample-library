import { Search } from "lucide-react";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function SearchBar({ value, onChange }: Props) {
  return (
    <div className="search">
      <Search size={16} className="search-icon" />
      <input
        type="text"
        placeholder="Search, or use tag:kick type:loop bpm:90-110 fav missing"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search samples"
      />
    </div>
  );
}
