package com.example.app;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Signup, login, and one protected route. Copy the Authorization header check
 * in {@link #me} onto any endpoint that needs a signed-in user — or move it
 * into a filter or interceptor once there are several.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    public record Credentials(String email, String password) {
    }

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@RequestBody Credentials credentials) {
        try {
            AuthService.Account account = auth.register(credentials.email(), credentials.password());
            return ResponseEntity.status(HttpStatus.CREATED).body(session(account));
        } catch (IllegalArgumentException invalid) {
            return ResponseEntity.badRequest().body(Map.of("error", invalid.getMessage()));
        } catch (IllegalStateException taken) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", taken.getMessage()));
        }
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Credentials credentials) {
        AuthService.Account account = auth.authenticate(credentials.email(), credentials.password());
        if (account == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "wrong email or password"));
        }
        return ResponseEntity.ok(session(account));
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(@RequestHeader(value = "Authorization", required = false) String header) {
        String token = header != null && header.startsWith("Bearer ") ? header.substring(7) : null;
        AuthService.Account account = auth.readToken(token);
        if (account == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "not signed in"));
        }
        return ResponseEntity.ok(Map.of("user", account));
    }

    private Map<String, Object> session(AuthService.Account account) {
        return Map.of("token", auth.createToken(account), "user", account);
    }
}
