# Certificados de CA adicionales

Coloca aquí certificados raíz en formato PEM con extensión `.crt` cuando la red use
inspección TLS (por ejemplo, el firewall corporativo de Multicómputos). Las imágenes de
Docker los añaden al almacén del sistema y Node.js los usa mediante `--use-system-ca`.

- Son certificados públicos, pero específicos de cada red: no se versionan (`.gitignore`).
- Nunca se usa `NODE_TLS_REJECT_UNAUTHORIZED=0` para sortear estos errores.

Exportar la CA corporativa desde Windows (PowerShell):

```powershell
$cert = Get-ChildItem Cert:\LocalMachine\Root | Where-Object Subject -like '*multicomputos01-AUSTRIA-CA*'
$b64 = [Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks')
"-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----" | Out-File -Encoding ascii docker\certs\corporate-ca.crt
```
