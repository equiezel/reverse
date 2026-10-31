meta:
  id: artcam_version_info
  title: ArtCAM VersionInfo/VersionA
  file-extension: bin
  license: MIT
  endian: le
doc: |
  Stream OLE2 `ArtCAM/VersionInfo/VersionA`.

  Evidencia: `samples/art.art`; decodificado como UTF-16LE contiene
  `ArtCAM 9.021`. Confianza media: no se fijo un offset de campo, se decodifica
  el stream completo y se aplica una expresion regular sobre el texto.
seq:
  - id: text
    type: str
    encoding: UTF-16LE
    size-eos: true
