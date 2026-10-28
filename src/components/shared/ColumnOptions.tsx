import { groupByColumn } from "../../lib/propertyGroups";

/**
 * A column pop-up's options, collected as everywhere properties are listed:
 * Custom, then Native, then Media, each under its heading (none when all
 * are of one group).
 */
export default function ColumnOptions({ columns }: { columns: { id: string; label: string }[] }) {
  const groups = groupByColumn(columns, (c) => c.id);
  const option = (c: { id: string; label: string }) => (
    <option key={c.id} value={c.id}>
      {c.label}
    </option>
  );
  if (groups.length <= 1) return <>{columns.map(option)}</>;
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.group} label={g.label}>
          {g.items.map(option)}
        </optgroup>
      ))}
    </>
  );
}
