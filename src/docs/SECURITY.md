# Segurança

Provedores enviam `X-API-KEY`, `X-TIMESTAMP`, `X-NONCE`, `X-SIGNATURE`. A assinatura é HMAC-SHA256 de `METHOD`, caminho, timestamp, nonce e SHA-256 do corpo bruto. A comparação é tempo constante. Nonces são persistidos no PostgreSQL com TTL, portanto um Redis indisponível não reduz a proteção de replay financeira.

Segredos de provedor são cifrados com AES-256-GCM em repouso; a chave é derivada do segredo de ambiente. Em produção, substitua esta derivação por KMS envelope encryption e faça rotação de chave. A aplicação não armazena senhas nem refresh tokens administrativos: Keycloak emite tokens OIDC e o guard valida JWKS, emissor, audiência e roles.

Nunca versione `.env`, tokens, senhas ou API secrets. Logs JSON devem registrar IDs de correlação, carteira, transação e provedor, nunca os segredos.
