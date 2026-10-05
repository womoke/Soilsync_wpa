from __future__ import annotations

import datetime as dt
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def generate_self_signed_cert(cert_dir: Path) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, 'KE'),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'SoilSync AI'),
        x509.NameAttribute(NameOID.COMMON_NAME, 'localhost'),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1))
        .not_valid_after(dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName([
            x509.DNSName('localhost'),
            x509.IPAddress(ipaddress.ip_address('127.0.0.1')),
            x509.IPAddress(ipaddress.ip_address('::1')),
        ]), critical=False)
        .sign(key, hashes.SHA256())
    )

    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_path = cert_dir / 'localhost-cert.pem'
    key_path = cert_dir / 'localhost-key.pem'

    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ))

    print(f'Generated local certificate: {cert_path}')
    print(f'Generated local key: {key_path}')


if __name__ == '__main__':
    cert_dir = Path(__file__).resolve().parent.parent / 'certs'
    generate_self_signed_cert(cert_dir)
