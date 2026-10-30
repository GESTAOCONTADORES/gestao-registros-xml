import { useState } from 'react';

/**
 * Logo oficial da Gestão Contadores (public/assets/logo-gestao-contadores.png).
 * Enquanto o arquivo oficial não for fornecido, mostra apenas o nome em texto.
 */
export function Logo({ className = 'h-9', light = false }: { className?: string; light?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`font-bold tracking-tight ${light ? 'text-white' : 'text-navy-900'} text-lg leading-none`}>
        Gestão Contadores
      </span>
    );
  }
  return (
    <img
      src="/assets/logo-gestao-contadores.png"
      alt="Gestão Contadores"
      className={`${className} w-auto object-contain`}
      onError={() => setFailed(true)}
    />
  );
}
