"use client";

import React, { useState, useId } from "react";
import {
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Search,
  ShieldCheck,
  Plane,
  CreditCard,
  Car,
  Info,
} from "./icons";
import { FAQ_ITEMS, FAQ_CATEGORIES, type FaqCategoryId, type FaqItem } from "@/data/faqData";

interface FaqSectionProps {
  className?: string;
  airportName?: string;
}

export function FaqSection({ className = "", airportName }: FaqSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<FaqCategoryId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<string[]>(["faq-1", "faq-2"]);

  const searchInputId = useId();

  const filteredFaqs = FAQ_ITEMS.filter((item) => {
    const matchesCategory =
      selectedCategory === "all" || item.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      item.question.toLowerCase().includes(q) ||
      item.answer.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const handleToggle = (id: string) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const getCategoryIcon = (category: FaqItem["category"]) => {
    switch (category) {
      case "valet":
        return <Car size={16} className="text-blue" />;
      case "flights":
        return <Plane size={16} className="text-sky" />;
      case "security":
        return <ShieldCheck size={16} className="text-emerald" />;
      case "booking":
        return <CreditCard size={16} className="text-indigo" />;
    }
  };

  return (
    <section
      aria-labelledby="faq-heading"
      className={`faq-section-wrapper ${className}`}
    >
      <div className="faq-container">
        {/* Header */}
        <div className="faq-header">
          <div className="faq-pill">
            <HelpCircle size={14} />
            <span>Centro de Ayuda y Preguntas Frecuentes</span>
          </div>
          <h2 id="faq-heading" className="faq-title">
            ¿Tienes dudas sobre cómo funciona {airportName ? `en ${airportName}` : "el servicio"}?
          </h2>
          <p className="faq-subtitle">
            Todo lo que necesitas saber sobre el protocolo de entrega, custodia del vehículo, seguimiento de vuelos y garantías.
          </p>
        </div>

        {/* Categories Bar & Search Filter */}
        <div className="faq-filter-bar">
          <div className="faq-categories-row" role="tablist" aria-label="Categorías de preguntas">
            {FAQ_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`faq-cat-btn ${selectedCategory === cat.id ? "active" : ""}`}
                role="tab"
                aria-selected={selectedCategory === cat.id}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="faq-search-box">
            <Search size={15} className="faq-search-icon" />
            <input
              id={searchInputId}
              type="text"
              placeholder="Buscar por palabra clave (ej. retraso, llaves, seguro)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="faq-search-input"
              aria-label="Buscar en preguntas frecuentes"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="faq-clear-btn"
                aria-label="Borrar búsqueda"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* FAQs Accordion */}
        <div className="faq-accordion-list">
          {filteredFaqs.length === 0 ? (
            <div className="faq-empty-state">
              <p>No se encontraron respuestas para los criterios indicados.</p>
            </div>
          ) : (
            filteredFaqs.map((faq) => {
              const isExpanded = expandedIds.includes(faq.id);

              return (
                <div
                  key={faq.id}
                  className={`faq-item-card ${isExpanded ? "expanded" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => handleToggle(faq.id)}
                    className="faq-question-btn"
                    aria-expanded={isExpanded}
                    aria-controls={`faq-answer-${faq.id}`}
                  >
                    <div className="faq-q-left">
                      <span className="faq-icon-wrapper">
                        {getCategoryIcon(faq.category)}
                      </span>
                      <span className="faq-q-text">{faq.question}</span>
                    </div>
                    <span className="faq-toggle-arrow">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                  </button>

                  {isExpanded && (
                    <div
                      id={`faq-answer-${faq.id}`}
                      className="faq-answer-box"
                      role="region"
                    >
                      <p className="faq-answer-text">{faq.answer}</p>
                      {faq.highlight && (
                        <div className="faq-highlight-pill">
                          💡 <strong>Clave:</strong> {faq.highlight}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pending Validation Disclaimer */}
        <div className="faq-disclaimer-box">
          <Info size={14} className="disclaimer-icon" />
          <span>
            <strong>Nota informativa:</strong> Este contenido es orientativo y refleja los estándares operativos del marketplace. Cada operador autorizado publica sus condiciones particulares en su contrato de servicio.
          </span>
        </div>
      </div>
    </section>
  );
}
