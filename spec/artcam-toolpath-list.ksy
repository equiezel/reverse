meta:
  id: artcam_toolpath_list
  title: ArtCAM 9 toolpath list (#ToolpathList)
  file-extension: bin
  license: MIT
  endian: le
  encoding: ASCII
doc: |
  Contenido del stream OLE2 `ArtCAM/ToolpathData/#ToolpathList` del sample
  ArtCAM 9.021.

  Evidencia: `samples/art.art`, SHA-256 6867001f...; se leen dos IDs de
  toolpath y el parser TypeScript coincide con el dump manual. Confianza media:
  solo un sample.

  Los nombres incluyen el terminador NUL dentro de `length`. El campo
  `version` vale 1 en el sample, pero su semantica no esta confirmada.
seq:
  - id: version
    type: u2
    doc: Valor 1 en el sample; semantica no confirmada.
  - id: count
    type: u2
    doc: Cantidad de toolpaths. Dos en el sample.
  - id: entries
    type: entry
    repeat: expr
    repeat-expr: count
types:
  entry:
    seq:
      - id: length
        type: u2
        doc: Longitud en bytes del nombre, incluido el NUL final.
      - id: name
        type: str
        size: length
        doc: Nombre ASCII con NUL final.
