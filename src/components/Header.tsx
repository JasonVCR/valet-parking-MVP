"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Plane, Edit3, Check, LayoutDashboard, ShieldCheck } from "./icons";

interface HeaderProps {
  initialProductName?: string;
  isDemoMode?: boolean;
}

export function Header({
  initialProductName = "AeroValet & Parking Hub",
  isDemoMode = true,
}: HeaderProps) {
  const [productName, setProductName] = useState(initialProductName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(initialProductName);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempName.trim()) {
      setProductName(tempName.trim());
    }
    setIsEditingName(false);
  };

  const handleFeatureNotice = (featureName: string) => {
    setNotice(`${featureName}: Disponible en el próximo incremento tras validar la UI y búsqueda.`);
    setTimeout(() => setNotice(null), 4000);
  };

  return (
    <header className="site-header">
      {/* Top Demo Banner */}
      <div className="demo-top-banner" role="status" aria-live="polite">
        <span className="demo-dot" />
        <span>
          <strong>Prototipo UX / MVP Verificable:</strong> Precios calculados en servidor en céntimos enteros. {isDemoMode ? "Sin credenciales de Supabase en local (modo demo etiquetado)." : "Conexión en vivo con Supabase."}
        </span>
      </div>

      {notice && (
        <div className="notification-banner" role="status">
          <span>ℹ️ {notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="notice-close-btn"
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}

      <div className="header-container">
        <div className="header-row">
          {/* Brand Logo & Name */}
          <div className="brand-group">
            <Link
              href="/"
              className="logo-badge"
              title="Ir al inicio de búsqueda"
              aria-label="Ir al inicio de búsqueda"
            >
              <Plane className="logo-icon" size={20} />
            </Link>

            <div className="brand-info">
              {isEditingName ? (
                <form onSubmit={handleSaveName} className="brand-edit-form">
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    className="brand-input"
                    autoFocus
                    maxLength={32}
                    aria-label="Nombre del marketplace temporal"
                  />
                  <button
                    type="submit"
                    className="brand-save-btn"
                    title="Guardar nombre"
                    aria-label="Guardar nombre"
                  >
                    <Check size={14} />
                  </button>
                </form>
              ) : (
                <div className="brand-display">
                  <Link href="/" className="brand-title">
                    {productName}
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setTempName(productName);
                      setIsEditingName(true);
                    }}
                    className="brand-edit-btn"
                    title="Editar nombre temporal de marca"
                    aria-label="Editar nombre temporal de marca"
                  >
                    <Edit3 size={13} />
                  </button>
                </div>
              )}
              <span className="brand-subtitle">
                Marketplace Oficial de Aparcamiento en Aeropuertos
              </span>
            </div>
          </div>

          {/* Navigation and View links */}
          <nav className="header-nav" aria-label="Navegación principal">
            <Link href="/" className="nav-link active">
              Buscador
            </Link>
            <button
              type="button"
              onClick={() => handleFeatureNotice("Portal de Operadores")}
              className="nav-btn-secondary"
            >
              <LayoutDashboard size={14} />
              <span>Operadores</span>
              <span className="tag-soon">Inc. 2</span>
            </button>
            <button
              type="button"
              onClick={() => handleFeatureNotice("Gestión de Reservas")}
              className="nav-btn-outline"
            >
              <ShieldCheck size={14} />
              <span>Mis Reservas</span>
              <span className="tag-soon">Inc. 2</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
}
