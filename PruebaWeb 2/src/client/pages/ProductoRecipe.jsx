import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Input, Spinner } from "reactstrap";
import { api } from "../api.js";
import { useWorkspace } from "../App.jsx";
import "./ProductRecipe.css";

// Imagenes de Figma: carpeta public/img/ (se sirven desde la ruta /img/)
const IMG = "/img";

const UNITS = ["g", "kg", "ml", "l", "unidad"];

function newRecipeRow() {
  return {
    key: `${Date.now()}-${Math.random()}`,
    ingredientId: "",
    quantity: "",
    unit: "g",
  };
}

export default function ProductRecipe({ productId: propProductId = null }) {
  const { branchId, user } = useWorkspace();
  const canEdit = ["ADMIN", "MANAGER"].includes(user?.role);

  // Catalogos cargados desde el backend
  const [products, setProducts] = useState([]);
  const [ingredientsCatalog, setIngredientsCatalog] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(propProductId || "");

  // Filas de la receta (mínimo 3 filas visibles como en la maqueta)
  const [rows, setRows] = useState([newRecipeRow(), newRecipeRow(), newRecipeRow()]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // 1) Carga los insumos disponibles en inventario y los productos elaborados
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [inventoryData, productsData] = await Promise.all([
        api(`/inventory?branchId=${branchId}`),
        api(`/products?branchId=${branchId}`),
      ]);

      // Solo los insumos (INGREDIENT) pueden formar parte de una receta
      const onlyIngredients = inventoryData.filter((item) => item.type === "INGREDIENT");
      setIngredientsCatalog(onlyIngredients);
      setProducts(productsData);

      // Si no venía un productId por prop, selecciona el primero disponible
      if (!propProductId && productsData.length > 0) {
        setSelectedProductId(String(productsData[0].id));
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [branchId, propProductId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 2) Carga la receta existente cuando cambia el producto seleccionado
  useEffect(() => {
    if (!selectedProductId) return;

    let cancelled = false;
    async function loadRecipe() {
      setFormError("");
      setSuccessMsg("");
      try {
        const recipeItems = await api(`/products/${selectedProductId}/recipe`);
        if (cancelled) return;

        if (Array.isArray(recipeItems) && recipeItems.length > 0) {
          setRows(
            recipeItems.map((item) => ({
              key: `${item.ingredientId}-${Math.random()}`,
              ingredientId: String(item.ingredientId),
              quantity: String(item.quantity),
              unit: item.unit || "g",
            }))
          );
        } else {
          // Si el producto aún no tiene receta, muestra 3 filas vacías como en el diseño
          setRows([newRecipeRow(), newRecipeRow(), newRecipeRow()]);
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError.message);
      }
    }

    loadRecipe();
    return () => {
      cancelled = true;
    };
  }, [selectedProductId]);

  // Mapa rápido para conocer la unidad base de cada insumo seleccionado
  const ingredientsById = useMemo(() => {
    const map = new Map();
    ingredientsCatalog.forEach((ing) => map.set(String(ing.id), ing));
    return map;
  }, [ingredientsCatalog]);

  function addRow() {
    setFormError("");
    setSuccessMsg("");
    setRows((current) => [...current, newRecipeRow()]);
  }

  function removeRow(key) {
    setFormError("");
    setSuccessMsg("");
    setRows((current) => {
      const updated = current.filter((row) => row.key !== key);
      return updated.length > 0 ? updated : [newRecipeRow()];
    });
  }

  function handleIngredientChange(key, ingredientId) {
    const found = ingredientsById.get(String(ingredientId));
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              ingredientId,
              unit: found?.unit || row.unit,
            }
          : row
      )
    );
  }

  function handleFieldChange(key, field, value) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, [field]: value } : row))
    );
  }

  // Valida y guarda la receta completa en el backend
  async function saveRecipe() {
    setFormError("");
    setSuccessMsg("");

    if (!selectedProductId) {
      return setFormError("Selecciona un producto para asignarle su receta.");
    }

    // Filtramos filas completamente vacías
    const nonEmptyRows = rows.filter(
      (row) => row.ingredientId !== "" || String(row.quantity).trim() !== ""
    );

    if (nonEmptyRows.length === 0) {
      return setFormError("Agrega al menos un ingrediente con su cantidad.");
    }

    const usedIds = new Set();
    const payload = [];

    for (const row of nonEmptyRows) {
      if (!row.ingredientId) {
        return setFormError("Selecciona el ingrediente en todas las filas utilizadas.");
      }
      if (usedIds.has(row.ingredientId)) {
        return setFormError("No puedes repetir el mismo ingrediente en la receta.");
      }
      const qty = Number(row.quantity);
      if (row.quantity === "" || !Number.isFinite(qty) || qty <= 0) {
        return setFormError("Todas las cantidades deben ser mayores que 0.");
      }

      usedIds.add(row.ingredientId);
      payload.push({
        ingredientId: Number(row.ingredientId),
        quantity: qty,
        unit: row.unit,
      });
    }

    setSaving(true);
    try {
      await api(`/products/${selectedProductId}/recipe`, {
        method: "PUT",
        body: { items: payload },
      });
      setSuccessMsg("Receta guardada correctamente.");
    } catch (requestError) {
      setFormError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rec-page">
      <div className="rec-header">
        <h1 className="rec-title">Receta de producto</h1>

        {/* Selector de producto (si no viene fijo por prop) */}
        {!propProductId && products.length > 0 && (
          <div className="rec-product-selector">
            <label htmlFor="rec-product-select">Producto:</label>
            <Input
              id="rec-product-select"
              type="select"
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
            >
              {products.map((prod) => (
                <option key={prod.id} value={prod.id}>
                  {prod.name}
                </option>
              ))}
            </Input>
          </div>
        )}
      </div>

      {error && <Alert color="danger">{error}</Alert>}
      {formError && <Alert color="warning">{formError}</Alert>}
      {successMsg && <Alert color="success">{successMsg}</Alert>}

      {loading ? (
        <Spinner color="info" />
      ) : (
        <>
          <div className="rec-panels">
            {/* PANEL IZQUIERDO: INGREDIENTES */}
            <section className="rec-panel" aria-label="Ingredientes">
              <div className="rec-panel-banner">
                <img src={`${IMG}/Ingredientes.png`} alt="Ingredientes" />
              </div>

              <div className="rec-list">
                {rows.map((row) => (
                  <div className="rec-pill rec-pill-ingredient" key={row.key}>
                    {canEdit && (
                      <button
                        type="button"
                        className="rec-remove-btn"
                        aria-label="Quitar ingrediente"
                        onClick={() => removeRow(row.key)}
                      >
                        <img src={`${IMG}/EliminarReceta.png`} alt="" />
                      </button>
                    )}

                    <Input
                      type="select"
                      aria-label="Seleccionar ingrediente"
                      className="rec-select"
                      disabled={!canEdit}
                      value={row.ingredientId}
                      onChange={(event) =>
                        handleIngredientChange(row.key, event.target.value)
                      }
                    >
                      <option value="">Seleccionar ingrediente</option>
                      {ingredientsCatalog.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name} ({ing.unit})
                        </option>
                      ))}
                    </Input>

                    <span className="rec-caret rec-caret-purple" aria-hidden="true">
                      ▼
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* PANEL DERECHO: CANTIDAD */}
            <section className="rec-panel" aria-label="Cantidad">
              <div className="rec-panel-banner">
                <img src={`${IMG}/Cantidad.png`} alt="Cantidad" />
              </div>

              <div className="rec-list">
                {rows.map((row) => (
                  <div className="rec-pill rec-pill-quantity" key={row.key}>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      aria-label="Cantidad del ingrediente"
                      className="rec-qty-input"
                      placeholder="0"
                      disabled={!canEdit}
                      value={row.quantity}
                      onChange={(event) =>
                        handleFieldChange(row.key, "quantity", event.target.value)
                      }
                    />

                    <div className="rec-unit-wrap">
                      <Input
                        type="select"
                        aria-label="Unidad de medida"
                        className="rec-unit-select"
                        disabled={!canEdit}
                        value={row.unit}
                        onChange={(event) =>
                          handleFieldChange(row.key, "unit", event.target.value)
                        }
                      >
                        {UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </Input>
                      <span className="rec-caret rec-caret-blue" aria-hidden="true">
                        ▼
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* PIE DE PÁGINA: BOTÓN AÑADIR INGREDIENTE + GUARDAR */}
          {canEdit && (
            <div className="rec-footer">
              <div className="rec-add-slot">
                <button
                  type="button"
                  className="rec-add-btn"
                  aria-label="Añadir ingrediente"
                  onClick={addRow}
                >
                  <img src={`${IMG}/AñadirIngrediente.png`} alt="Añadir ingrediente" />
                </button>
              </div>

              <button
                type="button"
                className="rec-save-btn"
                disabled={saving}
                onClick={saveRecipe}
              >
                {saving ? "Guardando…" : "Guardar receta"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}