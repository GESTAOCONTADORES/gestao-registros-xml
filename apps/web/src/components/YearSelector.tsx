import { useYears } from '../api/hooks';

/** Seletor de ano. A lista vem da API e acrescenta novos anos automaticamente. */
export function YearSelector({ value, onChange, allowAll = false, id }: { value?: number; onChange: (y?: number) => void; allowAll?: boolean; id?: string }) {
  const { data: years = [] } = useYears();
  return (
    <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)} aria-label="Ano">
      {allowAll && <option value="">Todos os anos</option>}
      {[...years].reverse().map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}
