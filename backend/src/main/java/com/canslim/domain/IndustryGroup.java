package com.canslim.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "industry_groups")
public class IndustryGroup {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String code;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(nullable = false, length = 10)
    private String market;

    @Column(name = "parent_sector", length = 100)
    private String parentSector;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public String getCode() { return code; }
    public String getName() { return name; }
    public String getMarket() { return market; }
    public String getParentSector() { return parentSector; }
}
