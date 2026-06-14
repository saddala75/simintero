def test_simintero_contracts_importable_as_installed_package():
    # Imported from the installed package, NOT via sys.path hacks.
    from canonical_model import Case, EventEnvelope, Tenant, Actor
    assert Case.__name__ == "Case"
    assert EventEnvelope.__name__ == "EventEnvelope"
