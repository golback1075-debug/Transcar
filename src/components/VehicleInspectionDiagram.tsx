import React, { useState } from 'react';

export interface InspectionDamageMark {
  zoneNumber: number;
  damageType: 'scratch' | 'dent' | 'crack' | 'missing' | 'other';
  note?: string;
}

interface Props {
  selectedZones: InspectionDamageMark[];
  onChange?: (zones: InspectionDamageMark[]) => void;
  readOnly?: boolean;
  lang?: 'ar' | 'fr';
  title?: string;
}

// 62 precise inspection zones distributed across top-down car layout
export const VEHICLE_ZONES: Array<{ number: number; labelFr: string; labelAr: string; x: number; y: number }> = [
  // Front Bumper (1-6)
  { number: 1, labelFr: 'Pare-chocs avant (Extrémité gauche)', labelAr: 'الصادم الأمامي (يسار)', x: 90, y: 35 },
  { number: 2, labelFr: 'Pare-chocs avant (Coin gauche)', labelAr: 'الصادم الأمامي (ركن يسار)', x: 120, y: 30 },
  { number: 3, labelFr: 'Pare-chocs avant (Centre gauche)', labelAr: 'الصادم الأمامي (وسط يسار)', x: 160, y: 28 },
  { number: 4, labelFr: 'Pare-chocs avant (Centre droit)', labelAr: 'الصادم الأمامي (وسط يمين)', x: 200, y: 28 },
  { number: 5, labelFr: 'Pare-chocs avant (Coin droit)', labelAr: 'الصادم الأمامي (ركن يمين)', x: 240, y: 30 },
  { number: 6, labelFr: 'Pare-chocs avant (Extrémité droite)', labelAr: 'الصادم الأمامي (يمين)', x: 270, y: 35 },

  // Grille & Headlights (7-10)
  { number: 7, labelFr: 'Phare avant gauche', labelAr: 'المصباح الأمامي الأيسر', x: 110, y: 48 },
  { number: 8, labelFr: 'Calandre avant', labelAr: 'الشبكة الأمامية', x: 180, y: 44 },
  { number: 9, labelFr: 'Phare avant droit', labelAr: 'المصباح الأمامي الأيمن', x: 250, y: 48 },
  { number: 10, labelFr: 'Capot moteur (Centre)', labelAr: 'غطاء المحرك (الوسط)', x: 180, y: 70 },

  // Hood & Fenders (11-16)
  { number: 11, labelFr: 'Capot moteur (Côté gauche)', labelAr: 'غطاء المحرك (جانب أيسر)', x: 135, y: 70 },
  { number: 12, labelFr: 'Capot moteur (Côté droit)', labelAr: 'غطاء المحرك (جانب أيمن)', x: 225, y: 70 },
  { number: 13, labelFr: 'Aile avant gauche', labelAr: 'الرفرف الأمامي الأيسر', x: 95, y: 75 },
  { number: 14, labelFr: 'Aile avant droite', labelAr: 'الرفرف الأمامي الأيمن', x: 265, y: 75 },
  { number: 15, labelFr: 'Rétroviseur extérieur gauche', labelAr: 'مرآة الرؤية الخلفية اليسرى', x: 75, y: 95 },
  { number: 16, labelFr: 'Rétroviseur extérieur droit', labelAr: 'مرآة الرؤية الخلفية اليمنى', x: 285, y: 95 },

  // Windshield & Front Doors (17-24)
  { number: 17, labelFr: 'Pare-brise avant', labelAr: 'الزجاج الأمامي', x: 180, y: 98 },
  { number: 18, labelFr: 'Montant A gauche (Pillier)', labelAr: 'العمود الأمامي الأيسر', x: 120, y: 95 },
  { number: 19, labelFr: 'Montant A droit (Pillier)', labelAr: 'العمود الأمامي الأيمن', x: 240, y: 95 },
  { number: 20, labelFr: 'Porte avant gauche (Vitrage/Cadre)', labelAr: 'الباب الأمامي الأيسر (الإطار)', x: 100, y: 115 },
  { number: 21, labelFr: 'Porte avant gauche (Panneau)', labelAr: 'الباب الأمامي الأيسر (اللوحة)', x: 100, y: 135 },
  { number: 22, labelFr: 'Porte avant droite (Vitrage/Cadre)', labelAr: 'الباب الأمامي الأيمن (الإطار)', x: 260, y: 115 },
  { number: 23, labelFr: 'Porte avant droite (Panneau)', labelAr: 'الباب الأمامي الأيمن (اللوحة)', x: 260, y: 135 },
  { number: 24, labelFr: 'Toit (Partie avant)', labelAr: 'السقف (الجزء الأمامي)', x: 180, y: 115 },

  // Roof & Center Body (25-34)
  { number: 25, labelFr: 'Toit (Centre)', labelAr: 'السقف (الوسط)', x: 180, y: 145 },
  { number: 26, labelFr: 'Toit (Partie arrière)', labelAr: 'السقف (الجزء الخلفي)', x: 180, y: 175 },
  { number: 27, labelFr: 'Montant B gauche', labelAr: 'العمود الأوسط الأيسر', x: 115, y: 155 },
  { number: 28, labelFr: 'Montant B droit', labelAr: 'العمود الأوسط الأيمن', x: 245, y: 155 },
  { number: 29, labelFr: 'Porte arrière gauche (Vitrage/Cadre)', labelAr: 'الباب الخلفي الأيسر (الإطار)', x: 100, y: 170 },
  { number: 30, labelFr: 'Porte arrière gauche (Panneau)', labelAr: 'الباب الخلفي الأيسر (اللوحة)', x: 100, y: 190 },
  { number: 31, labelFr: 'Porte arrière droite (Vitrage/Cadre)', labelAr: 'الباب الخلفي الأيمن (الإطار)', x: 260, y: 170 },
  { number: 32, labelFr: 'Porte arrière droite (Panneau)', labelAr: 'الباب الخلفي الأيمن (اللوحة)', x: 260, y: 190 },
  { number: 33, labelFr: 'Bas de caisse gauche (Seuil)', labelAr: 'عتبة الباب اليسرى', x: 88, y: 155 },
  { number: 34, labelFr: 'Bas de caisse droit (Seuil)', labelAr: 'عتبة الباب اليمنى', x: 272, y: 155 },

  // Rear Windows & Fenders (35-46)
  { number: 35, labelFr: 'Montant C gauche', labelAr: 'العمود الخلفي الأيسر', x: 120, y: 205 },
  { number: 36, labelFr: 'Montant C droit', labelAr: 'العمود الخلفي الأيمن', x: 240, y: 205 },
  { number: 37, labelFr: 'Vitre latérale arrière gauche', labelAr: 'النافذة الجانبية الخلفية اليسرى', x: 110, y: 185 },
  { number: 38, labelFr: 'Vitre latérale arrière droite', labelAr: 'النافذة الجانبية الخلفية اليمنى', x: 250, y: 185 },
  { number: 39, labelFr: 'Aile arrière gauche', labelAr: 'الرفرف الخلفي الأيسر', x: 95, y: 215 },
  { number: 40, labelFr: 'Aile arrière droite', labelAr: 'الرفرف الخلفي الأيمن', x: 265, y: 215 },
  { number: 41, labelFr: 'Roue avant gauche (Pneu/Jante)', labelAr: 'العجلة الأمامية اليسرى', x: 72, y: 78 },
  { number: 42, labelFr: 'Roue avant droite (Pneu/Jante)', labelAr: 'العجلة الأمامية اليمنى', x: 288, y: 78 },
  { number: 43, labelFr: 'Roue arrière gauche (Pneu/Jante)', labelAr: 'العجلة الخلفية اليسرى', x: 72, y: 210 },
  { number: 44, labelFr: 'Roue arrière droite (Pneu/Jante)', labelAr: 'العجلة الخلفية اليمنى', x: 288, y: 210 },
  { number: 45, labelFr: 'Passage de roue avant gauche', labelAr: 'إطار العجلة الأمامية اليسرى', x: 85, y: 78 },
  { number: 46, labelFr: 'Passage de roue avant droit', labelAr: 'إطار العجلة الأمامية اليمنى', x: 275, y: 78 },

  // Rear Trunk & Windshield (47-56)
  { number: 47, labelFr: 'Passage de roue arrière gauche', labelAr: 'إطار العجلة الخلفية اليسرى', x: 85, y: 210 },
  { number: 48, labelFr: 'Passage de roue arrière droit', labelAr: 'إطار العجلة الخلفية اليمنى', x: 275, y: 210 },
  { number: 49, labelFr: 'Pare-brise arrière (Lunette)', labelAr: 'الزجاج الخلفي', x: 180, y: 215 },
  { number: 50, labelFr: 'Coffre / Hayon (Centre)', labelAr: 'صندوق الأمتعة (الوسط)', x: 180, y: 245 },
  { number: 51, labelFr: 'Coffre / Hayon (Côté gauche)', labelAr: 'صندوق الأمتعة (جانب أيسر)', x: 140, y: 245 },
  { number: 52, labelFr: 'Coffre / Hayon (Côté droit)', labelAr: 'صندوق الأمتعة (جانب أيمن)', x: 220, y: 245 },
  { number: 53, labelFr: 'Poignée de coffre / Logo', labelAr: 'مقبض صندوق الأمتعة', x: 180, y: 260 },
  { number: 54, labelFr: 'Charnière de coffre gauche', labelAr: 'مفصلة صندوق الأمتعة اليسرى', x: 130, y: 225 },
  { number: 55, labelFr: 'Charnière de coffre droite', labelAr: 'مفصلة صندوق الأمتعة اليمنى', x: 230, y: 225 },
  { number: 56, labelFr: 'Phares antibrouillard arrière', labelAr: 'مصابيح الضباب الخلفية', x: 180, y: 275 },

  // Rear Bumper & Trim (57-62)
  { number: 57, labelFr: 'Feu arrière gauche', labelAr: 'المصباح الخلفي الأيسر', x: 110, y: 268 },
  { number: 58, labelFr: 'Feu arrière droit', labelAr: 'المصباح الخلفي الأيمن', x: 250, y: 268 },
  { number: 59, labelFr: 'Pare-chocs arrière (Extrémité gauche)', labelAr: 'الصادم الخلفي (يسار)', x: 95, y: 285 },
  { number: 60, labelFr: 'Pare-chocs arrière (Centre)', labelAr: 'الصادم الخلفي (الوسط)', x: 180, y: 288 },
  { number: 61, labelFr: 'Pare-chocs arrière (Extrémité droite)', labelAr: 'الصادم الخلفي (يمين)', x: 265, y: 285 },
  { number: 62, labelFr: 'Emplacement plaque d’immatriculation arrière', labelAr: 'مكان لوحة الإعدام الخلفية', x: 180, y: 270 },
];

export const VehicleInspectionDiagram: React.FC<Props> = ({
  selectedZones,
  onChange,
  readOnly = false,
  lang = 'fr',
  title,
}) => {
  const [activeZone, setActiveZone] = useState<number | null>(null);
  const [damageType, setDamageType] = useState<InspectionDamageMark['damageType']>('scratch');
  const [note, setNote] = useState('');

  const handleZoneClick = (zoneNumber: number) => {
    if (readOnly) return;
    const existing = selectedZones.find((z) => z.zoneNumber === zoneNumber);
    if (existing) {
      // remove or edit
      if (onChange) {
        onChange(selectedZones.filter((z) => z.zoneNumber !== zoneNumber));
      }
    } else {
      setActiveZone(zoneNumber);
      setDamageType('scratch');
      setNote('');
    }
  };

  const handleAddDamage = () => {
    if (!activeZone || !onChange) return;
    const filtered = selectedZones.filter((z) => z.zoneNumber !== activeZone);
    onChange([...filtered, { zoneNumber: activeZone, damageType, note: note.trim() }]);
    setActiveZone(null);
    setNote('');
  };

  const handleRemoveMark = (zoneNumber: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (readOnly || !onChange) return;
    onChange(selectedZones.filter((z) => z.zoneNumber !== zoneNumber));
  };

  const markedMap = new Map<number, InspectionDamageMark>();
  for (const m of selectedZones) {
    markedMap.set(m.zoneNumber, m);
  }

  return (
    <div className="flex flex-col gap-3 p-3 bg-white border border-[#cbd5e1] rounded-lg">
      {title && (
        <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-2">
          <h4 className="font-title text-[13px] font-bold text-[#93000B]">{title}</h4>
          <span className="text-[11px] font-semibold text-[#475569]">
            {selectedZones.length} {lang === 'ar' ? 'مناطق متضررة' : 'zones marquées'}
          </span>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 items-center justify-center">
        {/* SVG Top-Down Car Wireframe with 62 Inspection Zones */}
        <div className="relative bg-[#f8fafc] border border-[#cbd5e1] rounded-lg p-2 flex items-center justify-center w-full max-w-[360px]">
          <svg
            viewBox="0 0 360 320"
            className="w-full h-auto"
            aria-label="Schéma d'inspection technique du véhicule (62 zones)"
          >
            {/* Background & Technical Grid Lines */}
            <rect x="5" y="5" width="350" height="310" rx="6" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1" />
            <line x1="180" y1="10" x2="180" y2="310" stroke="#cbd5e1" strokeWidth="0.8" strokeDasharray="3,3" />

            {/* Car Body Top-Down Outline */}
            <g fill="#f1f5f9" stroke="#1e293b" strokeWidth="1.8" strokeLinejoin="round">
              {/* Wheels */}
              <rect x="58" y="65" width="22" height="42" rx="4" fill="#334155" />
              <rect x="280" y="65" width="22" height="42" rx="4" fill="#334155" />
              <rect x="58" y="195" width="22" height="42" rx="4" fill="#334155" />
              <rect x="280" y="195" width="22" height="42" rx="4" fill="#334155" />

              {/* Side Mirrors */}
              <path d="M78 90 L65 85 L65 100 L78 95 Z" fill="#475569" />
              <path d="M282 90 L295 85 L295 100 L282 95 Z" fill="#475569" />

              {/* Main Body Shell */}
              <path d="M90 55 C90 35 120 30 180 30 C240 30 270 35 270 55 L280 90 L280 220 L270 260 C270 280 240 290 180 290 C120 290 90 280 90 260 L80 220 L80 90 Z" />

              {/* Hood */}
              <path d="M100 55 C120 48 240 48 260 55 L260 90 L100 90 Z" fill="#ffffff" />

              {/* Front Windshield */}
              <path d="M105 92 L255 92 L245 118 L115 118 Z" fill="#e2e8f0" />

              {/* Roof */}
              <path d="M115 120 L245 120 L245 190 L115 190 Z" fill="#ffffff" />

              {/* Rear Windshield */}
              <path d="M115 192 L245 192 L255 218 L105 218 Z" fill="#e2e8f0" />

              {/* Trunk */}
              <path d="M100 220 L260 220 L270 260 C250 270 110 270 90 260 Z" fill="#ffffff" />
            </g>

            {/* 62 Numbered Inspection Zones */}
            {VEHICLE_ZONES.map((zone) => {
              const mark = markedMap.get(zone.number);
              const isMarked = Boolean(mark);
              return (
                <g
                  key={zone.number}
                  onClick={() => handleZoneClick(zone.number)}
                  className="cursor-pointer group"
                >
                  <circle
                    cx={zone.x}
                    cy={zone.y}
                    r={isMarked ? 11 : 9}
                    fill={isMarked ? '#dc2626' : '#ffffff'}
                    stroke={isMarked ? '#991b1b' : '#334155'}
                    strokeWidth={isMarked ? '2' : '1.2'}
                  />
                  <text
                    x={zone.x}
                    y={zone.y + 3.5}
                    fontSize="9.5"
                    fontWeight="bold"
                    fill={isMarked ? '#ffffff' : '#1e293b'}
                    textAnchor="middle"
                    fontFamily="monospace"
                  >
                    {zone.number}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend / Zone Details / Editor */}
        <div className="flex-1 flex flex-col gap-2 min-w-0 w-full">
          {!readOnly && activeZone && (
            <div className="p-3 rounded-lg bg-[#F6F2F7] border border-[#93000B] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-headline text-[13px] font-bold text-[#93000B]">
                  Zone #{activeZone} : {lang === 'ar' ? VEHICLE_ZONES.find(z => z.number === activeZone)?.labelAr : VEHICLE_ZONES.find(z => z.number === activeZone)?.labelFr}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveZone(null)}
                  className="text-[11px] text-[#5B403D] hover:underline"
                >
                  Annuler
                </button>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={damageType}
                  onChange={(e) => setDamageType(e.target.value as InspectionDamageMark['damageType'])}
                  className="rounded border border-[#E4BEB9] bg-white px-2.5 py-1 text-[12px]"
                >
                  <option value="scratch">Rayure (خربشة)</option>
                  <option value="dent">Enfoncement (صدمة/عوج)</option>
                  <option value="crack">Fissure (تصدع/كسر)</option>
                  <option value="missing">Pièce manquante (قطعة مفقودة)</option>
                  <option value="other">Autre défaut (عطل آخر)</option>
                </select>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (ex: 5cm, aile...)"
                  className="flex-1 rounded border border-[#E4BEB9] bg-white px-2.5 py-1 text-[12px]"
                />
              </div>
              <button
                type="button"
                onClick={handleAddDamage}
                className="self-end px-3 py-1.5 rounded bg-[#93000B] text-white font-label text-[12px] font-semibold hover:bg-[#B91C1C] cursor-pointer"
              >
                Enregistrer le dommage
              </button>
            </div>
          )}

          <div className="max-h-[240px] overflow-y-auto flex flex-col gap-1.5 pr-1">
            {selectedZones.length === 0 ? (
              <p className="text-[12px] text-[#5B403D] italic py-2">
                {lang === 'ar' ? 'لا توجد أضرار مسجلة. انقر على أي رقم في الرسم لتسجيل ضرر.' : 'Aucun dommage marqué. Cliquez sur un numéro du diagramme pour marquer un défaut.'}
              </p>
            ) : (
              selectedZones.map((m) => {
                const zInfo = VEHICLE_ZONES.find((z) => z.number === m.zoneNumber);
                return (
                  <div
                    key={m.zoneNumber}
                    className="flex items-center justify-between gap-2 p-2 rounded border border-[#E4BEB9] bg-[#fff5f5] text-[12px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-[#dc2626] text-white font-mono font-bold text-[11px] flex items-center justify-center shrink-0">
                        {m.zoneNumber}
                      </span>
                      <div className="min-w-0">
                        <span className="font-semibold text-[#111827] block truncate">
                          {lang === 'ar' ? zInfo?.labelAr : zInfo?.labelFr}
                        </span>
                        <span className="text-[11px] text-[#dc2626] block">
                          {m.damageType === 'scratch' ? 'Rayure' : m.damageType === 'dent' ? 'Enfoncement' : m.damageType === 'crack' ? 'Fissure' : m.damageType === 'missing' ? 'Manquant' : 'Autre'} {m.note ? `· ${m.note}` : ''}
                        </span>
                      </div>
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={(e) => handleRemoveMark(m.zoneNumber, e)}
                        className="text-[#93000B] hover:text-red-700 p-1 cursor-pointer"
                        title="Supprimer"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
