import React, { useEffect, useRef, useState } from 'react';
import type { CustomerItem } from '../types.ts';

interface Props {
  customers: CustomerItem[];
  selectedDriverId: number | null;
  fallbackDriverName?: string;
  renterCustomerId?: number;
  onSelectClient: (customer: CustomerItem | null) => void;
  onRequestAddClient: (prefillName: string) => void;
}

export const DriverClientSelector: React.FC<Props> = ({
  customers,
  selectedDriverId,
  fallbackDriverName = '',
  renterCustomerId,
  onSelectClient,
  onRequestAddClient,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedClient = selectedDriverId
    ? customers.find((c) => c.id === selectedDriverId) || null
    : null;

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = customers.filter((c) => {
    if (!q) return true;
    return (
      c.fullName.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.idNumber || '').toLowerCase().includes(q) ||
      (c.licenceNumber || '').toLowerCase().includes(q)
    );
  });

  const displayValue = open
    ? query
    : selectedClient
      ? selectedClient.fullName
      : fallbackDriverName;

  const hasValue = Boolean(selectedClient || fallbackDriverName.trim());

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <input
          type="text"
          value={displayValue}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
          }}
          placeholder="Rechercher client (nom, tél, pièce, permis)..."
          aria-label="Conducteur (si autre)"
          className="w-full rounded border border-[#E4BEB9] px-2.5 py-2 pr-14 text-[13px] bg-white"
        />
        <div className="absolute right-1.5 flex items-center gap-0.5">
          {hasValue && (
            <button
              type="button"
              title="Effacer le conducteur"
              onClick={() => {
                onSelectClient(null);
                setQuery('');
                setOpen(false);
              }}
              className="w-6 h-6 rounded hover:bg-[#F6F2F7] text-[#5B403D] flex items-center justify-center cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setQuery('');
              setOpen((prev) => !prev);
            }}
            className="w-6 h-6 rounded hover:bg-[#F6F2F7] text-[#5B403D] flex items-center justify-center cursor-pointer"
          >
            <span className="material-symbols-outlined text-[17px]">
              {open ? 'expand_less' : 'expand_more'}
            </span>
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-1 z-40 bg-white border border-[#E4BEB9] rounded-lg shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-y-auto divide-y divide-[#F0EDF1]">
            <button
              type="button"
              onClick={() => {
                onSelectClient(null);
                setQuery('');
                setOpen(false);
              }}
              className={`w-full px-3 py-2 text-left text-[12px] hover:bg-[#F6F2F7] cursor-pointer flex items-center justify-between ${
                !hasValue ? 'bg-[#FFDAD6]/25 font-semibold text-[#93000B]' : 'text-[#5B403D]'
              }`}
            >
              <span>Aucun (identique au locataire)</span>
            </button>

            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-[#5B403D] text-center">
                Aucun client enregistré trouvé.
              </div>
            ) : (
              filtered.map((c) => {
                const isSelected = c.id === selectedDriverId;
                const isRenter = renterCustomerId !== undefined && c.id === renterCustomerId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onSelectClient(c);
                      setQuery('');
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-[#F6F2F7] cursor-pointer flex flex-col gap-0.5 ${
                      isSelected ? 'bg-[#FFDAD6]/30' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-[#1B1B1E]">
                        {c.fullName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isRenter && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F6F2F7] text-[#5B403D]">
                            Locataire
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-[#93000B] font-semibold">
                          {c.phone}
                        </span>
                      </div>
                    </div>
                    {(c.idNumber || c.licenceNumber || c.address) && (
                      <span className="text-[11px] text-[#5B403D] truncate">
                        {[
                          c.idNumber ? `Pièce: ${c.idNumber}` : '',
                          c.licenceNumber ? `Permis: ${c.licenceNumber}` : '',
                          c.address || '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              const prefill = query.trim();
              setOpen(false);
              setQuery('');
              onRequestAddClient(prefill);
            }}
            className="w-full px-3 py-2.5 bg-[#F6F2F7] hover:bg-[#FFDAD6]/40 border-t border-[#E4BEB9] text-left text-[12px] font-semibold text-[#93000B] flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            <span>
              {query.trim()
                ? `Ajouter "${query.trim()}" comme nouveau client`
                : 'Ajouter un nouveau client'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
