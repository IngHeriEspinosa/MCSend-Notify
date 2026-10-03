# DNS para la entregabilidad (SPF, DKIM y DMARC)

Autor: **Ing. Heri Espinosa**

Desde 2024, Gmail y Yahoo exigen a los remitentes masivos (más de 5.000 correos al día):

- SPF **y** DKIM;
- una política DMARC, aunque sea `p=none`, alineada con el dominio del remitente;
- baja en un clic (RFC 8058);
- una tasa de spam inferior al 0,3 %.

MC Send Notify cumple la baja en un clic en todos los envíos. Los registros DNS dependen de ti.

Al guardar un remitente, la plataforma consulta el DNS y muestra un semáforo por registro. Pulsa **Comprobar DNS** después de cada cambio, teniendo en cuenta que la propagación puede tardar hasta 48 h.

## SPF

Un **único** registro TXT en el dominio raíz (o en el dominio del MAIL FROM) que enumere a todos los que envían en su nombre:

```text
multicomputos.com.  TXT  "v=spf1 include:spf.protection.outlook.com include:amazonses.com include:_spf.resend.com ~all"
```

- **Qué incluir:** solo los proveedores que uses realmente. Hay un máximo de 10 consultas DNS: comprueba el resultado con una herramienta de validación de SPF.
- **Dos registros SPF invalidan ambos.** Combínalos en uno.

## DKIM

Lo genera cada proveedor:

| Proveedor     | Registros                                                                             |
| ------------- | ------------------------------------------------------------------------------------- |
| Microsoft 365 | 2 CNAME `selector1._domainkey` y `selector2._domainkey` (Defender › Políticas › DKIM) |
| Amazon SES    | 3 CNAME de Easy DKIM                                                                  |
| Resend        | 1 TXT `resend._domainkey`                                                             |

Algunos proveedores usan selectores propios que no se pueden adivinar. Si el semáforo de DKIM marca «no encontrado» y el proveedor indica el dominio como verificado, el aviso se puede ignorar: la comprobación de la plataforma no bloquea los envíos.

## DMARC

```text
_dmarc.multicomputos.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@multicomputos.com; adkim=r; aspf=r"
```

1. **Arranque:** empieza con `p=none` y revisa los informes `rua` durante 2–4 semanas.
2. **Endurecimiento:** cuando todo el correo legítimo esté alineado, sube a `p=quarantine` y después a `p=reject`.

## Recomendaciones

- **Subdominio de envío:** usa uno dedicado para las campañas, por ejemplo `news.multicomputos.com`. Así la reputación de las campañas no afecta al correo corporativo.
- **Dominio de seguimiento:** los enlaces de seguimiento usan el dominio de `APP_URL`. Debe tener un certificado válido (Caddy lo gestiona) y no estar en listas negras.
- **Supresiones:** no importes direcciones suprimidas ni compres listas. La plataforma suprime automáticamente los rebotes permanentes, las quejas y las bajas.
