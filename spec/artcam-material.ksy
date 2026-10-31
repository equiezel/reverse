meta:
  id: artcam_material_description
  title: ArtCAM MaterialDescription
  file-extension: bin
  license: MIT
  endian: le
  encoding: ASCII
doc: |
  Stream OLE2 `ArtCAM/Material/MaterialDescription`.

  Evidencia: `samples/art.art`; el nombre observado es `Material`. El u32
  inicial coincide con la longitud del texto y el parser lee desde el offset 4.
  Confianza media: un solo sample, no se probo con nombres no ASCII.
seq:
  - id: name_length
    type: u4
    doc: Longitud del nombre en bytes.
  - id: name
    type: str
    size: name_length
