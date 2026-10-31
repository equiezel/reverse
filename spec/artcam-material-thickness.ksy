meta:
  id: artcam_material_thickness
  title: ArtCAM MaterialThickness
  file-extension: bin
  license: MIT
  endian: le
doc: |
  Stream OLE2 `ArtCAM/Material/MaterialThickness`.

  Evidencia: `samples/art.art`; `DataView.getFloat64(offset 0, littleEndian)`
  devuelve 12.0, compatible con el espesor esperado. Confianza alta para este
  sample; falta un segundo archivo con otro espesor para descartar una constante.
  El valor puede ser negativo (se toma valor absoluto en el lector).
seq:
  - id: thickness_mm
    type: f8
