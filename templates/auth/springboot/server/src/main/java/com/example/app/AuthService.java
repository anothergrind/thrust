package com.example.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * A minimal auth stub: password hashing, an HMAC-signed token, and an
 * in-memory user store.
 *
 * Users vanish when the server restarts — replace the map with a JPA
 * repository when you're ready. The hashing (PBKDF2-SHA256) and the signing
 * are the real thing, including constant-time comparison.
 */
@Service
public class AuthService {

    public record Account(long id, String email) {
    }

    private record StoredUser(long id, String email, String passwordHash) {
    }

    private static final int PBKDF2_ROUNDS = 200_000;
    private static final long TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

    private final Map<String, StoredUser> users = new ConcurrentHashMap<>();
    private final AtomicLong nextId = new AtomicLong(1);
    private final ObjectMapper json = new ObjectMapper();
    private final SecureRandom random = new SecureRandom();
    private final String secret;

    public AuthService(@Value("${app.auth-secret:development-secret-change-me}") String secret) {
        this.secret = secret;
    }

    public Account register(String rawEmail, String password) {
        String email = rawEmail == null ? "" : rawEmail.trim().toLowerCase();
        if (email.isEmpty() || password == null || password.length() < 8) {
            throw new IllegalArgumentException("email and a password of 8+ characters are required");
        }

        StoredUser user = new StoredUser(nextId.getAndIncrement(), email, hash(password));
        if (users.putIfAbsent(email, user) != null) {
            throw new IllegalStateException("that email is already registered");
        }
        return new Account(user.id(), user.email());
    }

    public Account authenticate(String rawEmail, String password) {
        String email = rawEmail == null ? "" : rawEmail.trim().toLowerCase();
        StoredUser user = users.get(email);
        // One outcome for both cases, so this can't be used to enumerate accounts.
        if (user == null || password == null || !matches(password, user.passwordHash())) {
            return null;
        }
        return new Account(user.id(), user.email());
    }

    public String createToken(Account account) {
        try {
            Map<String, Object> claims = Map.of(
                    "sub", account.id(),
                    "email", account.email(),
                    "exp", Instant.now().getEpochSecond() + TOKEN_TTL_SECONDS);
            String payload = base64(json.writeValueAsBytes(claims));
            return payload + "." + sign(payload);
        } catch (Exception cause) {
            throw new IllegalStateException("could not create a token", cause);
        }
    }

    public Account readToken(String token) {
        if (token == null) {
            return null;
        }
        int dot = token.indexOf('.');
        if (dot <= 0) {
            return null;
        }

        String payload = token.substring(0, dot);
        if (!MessageDigest.isEqual(
                token.substring(dot + 1).getBytes(StandardCharsets.UTF_8),
                sign(payload).getBytes(StandardCharsets.UTF_8))) {
            return null;
        }

        try {
            Map<?, ?> claims = json.readValue(Base64.getUrlDecoder().decode(payload), Map.class);
            long expiry = ((Number) claims.get("exp")).longValue();
            if (expiry < Instant.now().getEpochSecond()) {
                return null;
            }
            return new Account(((Number) claims.get("sub")).longValue(), (String) claims.get("email"));
        } catch (Exception cause) {
            return null;
        }
    }

    private String hash(String password) {
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        return HexFormat.of().formatHex(salt) + ":" + HexFormat.of().formatHex(derive(password, salt));
    }

    private boolean matches(String password, String stored) {
        String[] parts = stored.split(":");
        byte[] salt = HexFormat.of().parseHex(parts[0]);
        return MessageDigest.isEqual(derive(password, salt), HexFormat.of().parseHex(parts[1]));
    }

    private byte[] derive(String password, byte[] salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, PBKDF2_ROUNDS, 256);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (Exception cause) {
            throw new IllegalStateException("could not hash the password", cause);
        }
    }

    private String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return base64(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception cause) {
            throw new IllegalStateException("could not sign the token", cause);
        }
    }

    private static String base64(byte[] raw) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }
}
