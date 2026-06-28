package com.canslim.api;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

/**
 * POST /api/auth/register  — 회원가입
 * POST /api/auth/login     — 로그인 → UUID 토큰
 * GET  /api/auth/me        — Bearer 토큰 → 사용자 정보
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private static final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(10);

    private final JdbcTemplate jdbc;

    public AuthController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── DTO records ─────────────────────────────────────────────
    record RegisterRequest(String email, String password) {}
    record LoginRequest(String email, String password) {}
    record RegisterResponse(Long userId, String email) {}
    record LoginResponse(String token) {}
    record MeResponse(String email, String plan, OffsetDateTime expiresAt) {}

    // ── SHA-256 토큰 해시 ────────────────────────────────────────
    private static String sha256(String input) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(bytes);
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 실패", e);
        }
    }

    // ── POST /api/auth/register ─────────────────────────────────
    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody RegisterRequest req) {
        if (req.email() == null || req.email().isBlank() ||
            req.password() == null || req.password().length() < 6) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "email과 6자 이상의 password가 필요합니다."));
        }

        // 중복 체크
        Integer exists = jdbc.queryForObject(
                "SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, req.email().trim());
        if (exists != null && exists > 0) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("error", "이미 등록된 이메일입니다."));
        }

        String hash = bcrypt.encode(req.password());
        Long userId = jdbc.queryForObject(
                "INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id",
                Long.class,
                req.email().trim(), hash);

        // 기본 free 구독 생성
        jdbc.update("INSERT INTO subscriptions (user_id, plan) VALUES (?, 'free')", userId);

        log.info("신규 사용자 등록: id={} email={}", userId, req.email());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new RegisterResponse(userId, req.email().trim()));
    }

    // ── POST /api/auth/login ────────────────────────────────────
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest req) {
        if (req.email() == null || req.password() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "email과 password가 필요합니다."));
        }

        Map<String, Object> user;
        try {
            user = jdbc.queryForMap(
                    "SELECT id, password_hash FROM users WHERE email = ?", req.email().trim());
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "이메일 또는 비밀번호가 올바르지 않습니다."));
        }

        String storedHash = (String) user.get("password_hash");
        if (!bcrypt.matches(req.password(), storedHash)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "이메일 또는 비밀번호가 올바르지 않습니다."));
        }

        Long userId = ((Number) user.get("id")).longValue();

        // 토큰 생성 (UUID) + 저장 (SHA-256 해시 — 빠른 직접 조회용)
        String rawToken = UUID.randomUUID().toString();
        String tokenHash = sha256(rawToken);
        jdbc.update("INSERT INTO api_keys (user_id, key_hash) VALUES (?, ?)", userId, tokenHash);

        log.info("로그인: userId={}", userId);
        return ResponseEntity.ok(new LoginResponse(rawToken));
    }

    // ── GET /api/auth/me ────────────────────────────────────────
    @GetMapping("/me")
    public ResponseEntity<?> me(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Authorization: Bearer <token> 헤더가 필요합니다."));
        }

        String rawToken = authHeader.substring(7).trim();
        String tokenHash = sha256(rawToken);

        // SHA-256 해시로 직접 조회 — O(1)
        Map<String, Object> keyRow;
        try {
            keyRow = jdbc.queryForMap(
                    "SELECT ak.user_id, u.email FROM api_keys ak " +
                    "JOIN users u ON u.id = ak.user_id WHERE ak.key_hash = ?", tokenHash);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "유효하지 않은 토큰입니다."));
        }

        Long userId = ((Number) keyRow.get("user_id")).longValue();
        String email = (String) keyRow.get("email");

        // 구독 정보
        Map<String, Object> sub;
        try {
            sub = jdbc.queryForMap(
                    "SELECT plan, expires_at FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
                    userId);
        } catch (Exception e) {
            sub = Map.of("plan", "free");
        }

        String plan = (String) sub.getOrDefault("plan", "free");
        OffsetDateTime expiresAt = sub.get("expires_at") instanceof java.sql.Timestamp ts
                ? ts.toInstant().atOffset(java.time.ZoneOffset.UTC) : null;

        return ResponseEntity.ok(new MeResponse(email, plan, expiresAt));
    }
}
