meta:
  id: artcam_tool_description
  title: ArtCAM tool description (inside toolpath Parameters)
  file-extension: bin
  license: MIT
  endian: le
doc: |
  Descripcion de herramienta serializada dentro del stream
  `ArtCAM/ToolpathData/<id>/Parameters`.

  Evidencia: el texto `3.17mm plana` aparece como UTF-16LE precedido por un u32
  con la cantidad de caracteres. No se fijo el offset del campo dentro del
  stream: el lector busca el patron `[u32 3..64][UTF-16LE imprimible]` y valida
  que contenga `mm`. Confianza media/baja para el offset, alta para el contenido
  en este sample.

  Limitacion: esta estructura no describe el resto del stream `Parameters`.
seq:
  - id: char_count
    type: u4
  - id: text
    type: str
    encoding: UTF-16LE
    size: char_count
