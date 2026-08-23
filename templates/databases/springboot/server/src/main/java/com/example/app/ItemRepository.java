package com.example.app;

import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Spring Data writes the implementation: findAll, save, deleteById and the
 * rest come for free, and method names like findByName become queries.
 */
public interface ItemRepository extends JpaRepository<Item, Long> {
}
