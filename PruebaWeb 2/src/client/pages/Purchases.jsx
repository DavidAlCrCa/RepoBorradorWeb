import { useEffect, useMemo, useState } from "react";
import { Alert, Input, Spinner } from "reactstrap";
import { api, formatDate, formatMoney } from "../api.js";
import { useWorkspace } from "../App.jsx";
import "./Purchases.css";

// Imágenes en public/img/
const IMG = "/img";

const today = new Date().toISOString().slice(0, 10);
const emptyLine = { itemId: "", quantity: "1", unitCost: "" };

export default function Purchases() {
  const { branchId, user } = useWorkspace();
  const canEdit = ["ADMIN", "MANAGER"].includes(user?.role);

  const [suppliers, setSuppliers] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [purchases, setPurchases] = useState([]);

  // Campos de factura (panel izquierdo)
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoice, setSupplierInvoice] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(today);
  const [dueAt, setDueAt] = useState(today);
  const [lines, setLines] = useState([{ ...emptyLine }, { ...emptyLine }, { ...emptyLine }]);

  // Buscador y filtro de proveedores (panel derecho)
  const [searchSupplier, setSearchSupplier] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [onlyPendingBalance, setOnlyPendingBalance] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadData() {
    const [supplierList, stock, purchaseList] = await Promise.all([
      api("/suppliers"),
      api(`/inventory?branchId=${branchId}`),
      api(`/purchases?branchId=${branchId}`)
    ]);
    setSuppliers(supplierList);
    setInventory(stock);
    setPurchases(purchaseList);
    if (!supplierId && supplierList[0]) {
      setSupplierId(String(supplierList[0].id));
    }
  }

  useEffect(() => {
    setLoading(true);
    setError("");
    loadData()
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [branchId]);

  const selectedItems = useMemo(
    () =>
      inventory.map((item) => ({
        value: `${item.type}:${item.id}`,
        label: `${item.name} (${item.unit})`,
        type: item.type,
        id: item.id,
        defaultCost: item.unitCost ?? item.cost ?? ""
      })),
    [inventory]
  );

  // Calcula totales por fila y totales generales
  const subtotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0),
        0
      ),
    [lines]
  );
  const totalWithIva = subtotal * 1.13;

  // Filtra proveedores / registros del panel derecho
  const filteredSuppliers = useMemo(() => {
    const term = searchSupplier.trim().toLowerCase();
    return suppliers.filter((sup) => {
      const infoText = `${sup.contact || sup.phone || sup.email || sup.address || ""}`.toLowerCase();
      const matchesSearch =
        !term ||
        (sup.name || "").toLowerCase().includes(term) ||
        infoText.includes(term);

      if (!matchesSearch) return false;
      if (!onlyPendingBalance) return true;

      const hasDebt = purchases.some(
        (p) => String(p.supplierId) === String(sup.id) && Number(p.outstanding || 0) > 0
      );
      return hasDebt;
    });
  }, [suppliers, purchases, searchSupplier, onlyPendingBalance]);

  function updateLine(index, key, value) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const updated = { ...line, [key]: value };
        // Si cambia el insumo y no tenía costo unitario, autocompleta si existe
        if (key === "itemId" && !line.unitCost) {
          const found = selectedItems.find((i) => i.value === value);
          if (found?.defaultCost !== "") updated.unitCost = String(found.defaultCost);
        }
        return updated;
      })
    );
  }

  function addLine() {
    setLines((current) => [...current, { ...emptyLine }]);
  }

  function removeLine(index) {
    setLines((current) => {
      if (current.length <= 1) return [{ ...emptyLine }];
      return current.filter((_, i) => i !== index);
    });
  }

  function cancelPurchaseForm() {
    setSupplierInvoice("");
    setPurchasedAt(today);
    setDueAt(today);
    setLines([{ ...emptyLine }, { ...emptyLine }, { ...emptyLine }]);
    setError("");
    setMessage("");
  }

  async function submit(event) {
    if (event) event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const validLines = lines.filter((line) => line.itemId);
      if (!validLines.length) {
        throw new Error("Selecciona al menos un insumo o artículo para registrar la compra.");
      }

      const items = validLines.map((line) => {
        const [type, id] = line.itemId.split(":");
        return {
          ...(type === "INGREDIENT" ? { ingredientId: Number(id) } : { productId: Number(id) }),
          quantity: Number(line.quantity),
          unitCost: Number(line.unitCost)
        };
      });

      const result = await api("/purchases", {
        method: "POST",
        body: {
          branchId,
          supplierId: Number(supplierId),
          supplierInvoice: supplierInvoice.trim() || `FAC-${Date.now().toString().slice(-5)}`,
          purchasedAt,
          dueAt,
          items
        }
      });

      setMessage(
        `Compra #${result.id} registrada. Cuenta por pagar: ${formatMoney(result.total)}.`
      );
      setSupplierInvoice("");
      setLines([{ ...emptyLine }, { ...emptyLine }, { ...emptyLine }]);
      await loadData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveSupplier(supplier) {
    const confirmed = window.confirm(
      `¿Quitar al proveedor "${supplier.name}" de la lista?`
    );
    if (!confirmed) return;
    setError("");
    try {
      await api(`/suppliers/${supplier.id}`, { method: "DELETE" });
      setSuppliers((current) => current.filter((s) => s.id !== supplier.id));
    } catch (requestError) {
      // Si el backend no permite borrar o es solo visual en lista, actualiza o muestra error
      setError(requestError.message);
    }
  }

  function formatSupplierInfo(supplier) {
    const parts = [
      supplier.phone,
      supplier.email,
      supplier.contact,
      supplier.address
    ].filter(Boolean);

    const lastPurchase = purchases.find(
      (p) => String(p.supplierId) === String(supplier.id) || p.supplier === supplier.name
    );
    if (lastPurchase) {
      parts.push(
        `Últ. factura: ${lastPurchase.supplierInvoice} (${formatDate(lastPurchase.purchasedAt)}) · Saldo: ${formatMoney(lastPurchase.outstanding)}`
      );
    }

    return parts.length ? parts.join(" · ") : "Proveedor registrado";
  }

  return (
    <div className="prov-page">
      {error && (
        <Alert color="danger" className="mb-3" toggle={() => setError("")}>
          {error}
        </Alert>
      )}
      {message && (
        <Alert color="success" className="mb-3" toggle={() => setMessage("")}>
          {message}
        </Alert>
      )}

      {loading ? (
        <div className="prov-loading">
          <Spinner color="success" />
        </div>
      ) : (
        <div className="prov-layout">
          {/* PANEL IZQUIERDO: REGISTRO DE FACTURAS DE COMPRA */}
          <aside className="invoice-panel">
            <header className="invoice-header">
              <h1 className="invoice-title">Registro de facturas de compra</h1>
              <div className="invoice-divider" />
            </header>

            <form className="invoice-form" onSubmit={submit}>
              {/* Fila superior: PROVEEDOR | FECHA | NO. FACTURA */}
              <div className="invoice-top-box">
                <div className="invoice-top-labels">
                  <span>PROVEEDOR</span>
                  <span>FECHA</span>
                  <span>NO. FACTURA</span>
                </div>

                <div className="invoice-top-inputs">
                  <div className="pill-wrap pill-supplier">
                    <Input
                      aria-label="Proveedor"
                      type="select"
                      value={supplierId}
                      disabled={!canEdit}
                      onChange={(event) => setSupplierId(event.target.value)}
                      required
                    >
                      <option value="">Proveedor</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </Input>
                    <span className="pill-arrow arrow-blue" aria-hidden="true">
                      ▼
                    </span>
                  </div>

                  <div className="pill-wrap pill-date">
                    <Input
                      aria-label="Fecha de compra"
                      type="date"
                      value={purchasedAt}
                      disabled={!canEdit}
                      onChange={(event) => {
                        setPurchasedAt(event.target.value);
                        setDueAt(event.target.value);
                      }}
                      required
                    />
                  </div>

                  <div className="pill-wrap pill-invoice">
                    <Input
                      aria-label="Número de factura del proveedor"
                      placeholder="No. factura"
                      maxLength={80}
                      value={supplierInvoice}
                      disabled={!canEdit}
                      onChange={(event) => setSupplierInvoice(event.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Bloque medio: INSUMO | CANTIDAD | TOTAL */}
              <div className="invoice-items-box">
                <div className="invoice-items-header">
                  <span className="col-insumo-lbl">INSUMO</span>
                  <span className="col-cant-lbl">CANTIDAD</span>
                  <span className="col-total-lbl">TOTAL</span>
                </div>

                <div className="invoice-lines">
                  {lines.map((line, index) => {
                    const lineTotal =
                      Number(line.quantity || 0) * Number(line.unitCost || 0);

                    return (
                      <div className="invoice-line-row" key={index}>
                        <div className="pill-wrap pill-insumo">
                          {canEdit && (
                            <button
                              type="button"
                              className="line-remove-btn"
                              aria-label="Quitar insumo"
                              onClick={() => removeLine(index)}
                            >
                              <img src={`${IMG}/EliminarReceta.png`} alt="" />
                            </button>
                          )}
                          <Input
                            aria-label="Insumo"
                            type="select"
                            value={line.itemId}
                            disabled={!canEdit}
                            onChange={(event) =>
                              updateLine(index, "itemId", event.target.value)
                            }
                          >
                            <option value="">Insumo</option>
                            {selectedItems.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </Input>
                          <span className="pill-arrow arrow-purple" aria-hidden="true">
                            ▼
                          </span>
                        </div>

                        <div className="pill-wrap pill-cant">
                          <Input
                            aria-label="Cantidad"
                            type="number"
                            step="0.001"
                            min="0.001"
                            placeholder="0"
                            value={line.quantity}
                            disabled={!canEdit}
                            onChange={(event) =>
                              updateLine(index, "quantity", event.target.value)
                            }
                          />
                          <Input
                            aria-label="Costo unitario"
                            type="number"
                            step="0.0001"
                            min="0"
                            placeholder="$"
                            className="cost-inline-input"
                            value={line.unitCost}
                            disabled={!canEdit}
                            onChange={(event) =>
                              updateLine(index, "unitCost", event.target.value)
                            }
                          />
                          <span className="pill-arrow arrow-blue" aria-hidden="true">
                            ▼
                          </span>
                        </div>

                        <div className="line-total-box" title="Total de línea">
                          {lineTotal > 0 ? formatMoney(lineTotal) : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {canEdit && (
                  <button
                    type="button"
                    className="add-line-link"
                    onClick={addLine}
                  >
                    + Añadir fila de insumo
                  </button>
                )}
              </div>

              {/* Bloque inferior: Botones Cancelar/Confirmar + Subtotal / Total con IVA */}
              <div className="invoice-bottom-box">
                <div className="invoice-actions-col">
                  <button
                    type="button"
                    className="img-action-banner"
                    disabled={busy || !canEdit}
                    onClick={cancelPurchaseForm}
                  >
                    <img src={`${IMG}/EliminarProducto.png`} alt="" />
                    <span className="banner-label">CANCELAR COMPRA</span>
                  </button>

                  <button
                    type="submit"
                    className="img-action-banner"
                    disabled={busy || !canEdit || !suppliers.length || !selectedItems.length}
                  >
                    <img src={`${IMG}/AñadirProducto.png`} alt="" />
                    <span className="banner-label">
                      {busy ? "GUARDANDO..." : "CONFIRMAR COMPRA"}
                    </span>
                  </button>
                </div>

                <div className="invoice-summary-col">
                  <div className="summary-row">
                    <span className="summary-label">SUBTOTAL</span>
                    <strong className="summary-value">{formatMoney(subtotal)}</strong>
                  </div>
                  <div className="summary-row">
                    <span className="summary-label">
                      TOTAL CON
                      <br />
                      IVA
                    </span>
                    <strong className="summary-value">{formatMoney(totalWithIva)}</strong>
                  </div>
                </div>
              </div>
            </form>
          </aside>

          {/* PANEL DERECHO: PROVEEDORES */}
          <section className="suppliers-panel">
            <header className="suppliers-header">
              <h2 className="suppliers-title">Proveedores</h2>
              <div className="suppliers-divider" />
            </header>

            <div className="suppliers-toolbar">
              <div className="suppliers-search-wrap">
                <img
                  src={`${IMG}/BotonBuscador.png`}
                  alt="Buscar"
                  className="suppliers-search-icon"
                />
                <Input
                  aria-label="Buscar proveedor"
                  className="suppliers-search-input"
                  value={searchSupplier}
                  onChange={(event) => setSearchSupplier(event.target.value)}
                />
              </div>

              <div className="suppliers-filter-wrap">
                <button
                  type="button"
                  className="suppliers-filter-btn"
                  aria-label="Filtrar proveedores"
                  aria-expanded={showFilters}
                  onClick={() => setShowFilters((prev) => !prev)}
                >
                  <img src={`${IMG}/Filtro.png`} alt="Filtrar" />
                </button>

                {showFilters && (
                  <div className="suppliers-filter-menu">
                    <button
                      type="button"
                      className={!onlyPendingBalance ? "active" : ""}
                      onClick={() => {
                        setOnlyPendingBalance(false);
                        setShowFilters(false);
                      }}
                    >
                      Todos los proveedores
                    </button>
                    <button
                      type="button"
                      className={onlyPendingBalance ? "active" : ""}
                      onClick={() => {
                        setOnlyPendingBalance(true);
                        setShowFilters(false);
                      }}
                    >
                      Con saldo pendiente
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="suppliers-table-wrap">
              <table className="suppliers-table">
                <thead>
                  <tr>
                    <th className="col-prov-nombre">PROVEEDORES</th>
                    <th className="col-prov-info">INFO PROVEEDORES</th>
                    {canEdit && <th className="col-prov-accion" aria-label="Acciones" />}
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((supplier) => (
                    <tr key={supplier.id}>
                      <td
                        className="prov-cell"
                        onClick={() => setSupplierId(String(supplier.id))}
                        title="Seleccionar proveedor en la factura"
                      >
                        {supplier.name}
                      </td>
                      <td className="prov-cell">{formatSupplierInfo(supplier)}</td>
                      {canEdit && (
                        <td className="prov-action-cell">
                          <button
                            type="button"
                            className="prov-delete-btn"
                            aria-label={`Eliminar ${supplier.name}`}
                            onClick={() => handleRemoveSupplier(supplier)}
                          >
                            <img src={`${IMG}/EliminarReceta.png`} alt="" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}

                  {/* Filas de relleno para mantener el aspecto visual cuando hay pocos registros */}
                  {Array.from({
                    length: Math.max(0, 5 - filteredSuppliers.length)
                  }).map((_, idx) => (
                    <tr key={`empty-sup-${idx}`} className="prov-empty-row">
                      <td className="prov-cell">&nbsp;</td>
                      <td className="prov-cell"></td>
                      {canEdit && <td className="prov-action-cell"></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}