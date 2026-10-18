"use client";

import React from "react";
import Image from "next/image";
import type { FacilityWithServices } from "@/types/domain";
import { Columns3, X, Trash2, ArrowRight } from "./icons";

interface ComparisonBarProps {
  selectedFacilities: FacilityWithServices[];
  onOpenComparison: () => void;
  onRemoveFacility: (id: string) => void;
  onClearAll: () => void;
}

export function ComparisonBar({
  selectedFacilities,
  onOpenComparison,
  onRemoveFacility,
  onClearAll,
}: ComparisonBarProps) {
  if (selectedFacilities.length === 0) return null;

  return (
    <aside
      aria-label="Barra de comparativa de parkings"
      className="comparison-floating-bar"
    >
      <div className="comparison-bar-inner">
        {/* Left: Summary & Selected Mini Chips */}
        <div className="comparison-chips-container">
          <div className="comparison-badge-summary">
            <Columns3 size={15} />
            <span className="comparison-badge-title">Comparador:</span>
            <span className="comparison-counter">
              {selectedFacilities.length}/3
            </span>
          </div>

          <div className="comparison-chips-list">
            {selectedFacilities.map((f) => {
              const isValet = f.name.toLowerCase().includes("valet");
              const img = isValet
                ? "/images/valet_terminal_dropoff_1792282144660.jpg"
                : "/images/covered_parking_facility_1792282144148.jpg";

              return (
                <div key={f.id} className="comparison-chip">
                  <div className="chip-img-wrapper">
                    <Image
                      src={img}
                      alt={f.name}
                      width={24}
                      height={24}
                      className="chip-img"
                    />
                  </div>
                  <span className="chip-name">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveFacility(f.id)}
                    className="chip-remove-btn"
                    title={`Quitar ${f.name}`}
                    aria-label={`Quitar ${f.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="comparison-actions">
          <button
            type="button"
            onClick={onClearAll}
            className="btn-clear-comparison"
          >
            <Trash2 size={13} />
            <span>Limpiar</span>
          </button>

          <button
            type="button"
            onClick={onOpenComparison}
            className="btn-open-comparison"
          >
            <span>Ver tabla comparativa</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
